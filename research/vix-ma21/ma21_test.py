"""21 moving average strategies on V100 and V100(1s), with the same strict method as research/vix100-quant.

Rules (21 EMA and 21 SMA each, fixed before any result was seen):
  * cross:    buy when a candle closes above the 21 MA after closing at or below it; sell on the reverse.
  * pullback: MA rising over 5 candles and the previous close above it; the candle dips to the MA and
              closes back above it as a green candle -> buy. Sell is the mirror.
Each rule on 15m / 30m / 1H / 4H, stop 1 / 2 / 3 ATR, exit RR 1 / 2 / 3 or the opposite signal.
Choose on period A (to 30 Jun 2026), score the choice on period B (1 Jul onward), then repeat on shuffled
histories to see how often pure luck finds a better "best".

Run:  python3 ma21_test.py        (real prices + 40 shuffled histories)
"""
import sys
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

QUANT_FOLDER = Path(__file__).resolve().parent.parent / "vix100-quant"
sys.path.insert(0, str(QUANT_FOLDER))

from engine import CandleArrays, simulate  # noqa: E402
from metrics import full_metrics, robustness_score, t_value  # noqa: E402
from rules import average_true_range, build_bars, crossed_above, signals_from  # noqa: E402
from search import (COST_PER_TRADE, MARKETS, MINIMUM_TRADES_PERIOD_A, SHUFFLED_SEED_BASE, boundaries,  # noqa: E402
                    load_candles, market_regimes, shuffled_candles, trades_between)

OUTPUT_FOLDER = Path(__file__).resolve().parent / "output"
MA_LENGTH = 21
SLOPE_LOOKBACK = 5
TIMEFRAMES = (15, 30, 60, 240)
STOPS = (1.0, 2.0, 3.0)
TARGETS = (1.0, 2.0, 3.0, None)
SHUFFLED_HISTORIES = 40
WORKERS = 8


@dataclass(frozen=True)
class Setting:
    """This class holds one complete 21 MA strategy: rule, average type, timeframe, stop and exit."""
    rule: str
    average: str
    minutes: int
    stop_atr: float
    reward_risk: Optional[float]

    def label(self):
        """This function gives the setting a short readable name for the tables."""
        exit_name = "opposite signal" if self.reward_risk is None else f"RR {self.reward_risk:g}"
        return f"{self.rule} {self.average}21 {self.minutes}m stop {self.stop_atr:g} ATR {exit_name}"


def moving_average(close, average):
    """This function returns the 21 EMA or 21 SMA of the closes."""
    if average == "EMA":
        return close.ewm(span=MA_LENGTH, adjust=False, min_periods=MA_LENGTH).mean()
    return close.rolling(MA_LENGTH).mean()


def cross_signals(bars, line):
    """This function buys when the close crosses above the line and sells when it crosses below."""
    return signals_from(crossed_above(bars.close, line), crossed_above(line, bars.close))


def pullback_signals(bars, line):
    """This function buys a dip to a rising line that closes back above it green, and mirrors it for sells."""
    rising, falling = line > line.shift(SLOPE_LOOKBACK), line < line.shift(SLOPE_LOOKBACK)
    previous_close, previous_line = bars.close.shift(1), line.shift(1)
    buy = rising & (previous_close > previous_line) & (bars.low <= line) & (bars.close > line) & (bars.close > bars.open)
    sell = falling & (previous_close < previous_line) & (bars.high >= line) & (bars.close < line) & (bars.close < bars.open)
    return signals_from(buy, sell)


RULES = {"cross": cross_signals, "pullback": pullback_signals}


def every_setting():
    """This function lists all 192 settings, fixed before any result is seen."""
    return [Setting(rule, average, minutes, stop, target) for rule in RULES for average in ("EMA", "SMA")
            for minutes in TIMEFRAMES for stop in STOPS for target in TARGETS]


def run_every_setting(candles):
    """This function plays every setting over one history and returns the trades of each."""
    arrays = CandleArrays.from_candles(candles)
    bars_by_minutes, all_trades = {}, {}
    for setting in every_setting():
        if setting.minutes not in bars_by_minutes:
            bars = build_bars(candles, setting.minutes)
            bars_by_minutes[setting.minutes] = (bars, average_true_range(bars))
        bars, atr = bars_by_minutes[setting.minutes]
        signals = RULES[setting.rule](bars, moving_average(bars.close, setting.average))
        all_trades[setting] = simulate(arrays, bars.first_candle.to_numpy(), signals, atr.to_numpy(),
                                       setting.stop_atr, setting.reward_risk, COST_PER_TRADE)
    return all_trades


def choose_on_period_a(all_trades, regimes, start, split):
    """This function picks the setting with the best robustness score using period A only."""
    scored = [(robustness_score(trades_between(trades, start, split), regimes, start, split), setting)
              for setting, trades in all_trades.items()
              if len(trades_between(trades, start, split)) >= MINIMUM_TRADES_PERIOD_A]
    score, setting = max(scored, key=lambda pair: pair[0])
    return setting, score


def search_history(job):
    """This function runs the full choose-on-A, score-on-B search for one market and one history."""
    market, seed = job
    real = load_candles(market)
    candles = real if seed is None else shuffled_candles(real, SHUFFLED_SEED_BASE * (seed + 1) + MARKETS.index(market))
    regimes = market_regimes(candles)
    all_trades = run_every_setting(candles)
    start, split, end = boundaries(candles)
    chosen, score = choose_on_period_a(all_trades, regimes, start, split)
    period_a, period_b = trades_between(all_trades[chosen], start, split), trades_between(all_trades[chosen], split, end)
    summary = {"market": market, "seed": -1 if seed is None else seed, "setting": chosen.label(), "score_A": score,
               "trades_A": len(period_a), "net_R_A": float(period_a.net_r.sum()), "t_A": t_value(period_a.net_r),
               "trades_B": len(period_b), "net_R_B": float(period_b.net_r.sum()), "t_B": t_value(period_b.net_r)}
    print(f"{market} seed {seed}: {chosen.label()} A {summary['net_R_A']:+.1f}R B {summary['net_R_B']:+.1f}R", flush=True)
    if seed is None:
        save_all_tests(market, all_trades, candles)
    return summary


def save_all_tests(market, all_trades, candles):
    """This function writes every setting's period A, B and whole-year results for checking by hand."""
    start, split, end = boundaries(candles)
    rows = []
    for setting, trades in all_trades.items():
        row = {"market": market, "setting": setting.label()}
        for name, first, last in (("A", start, split), ("B", split, end), ("all", start, end)):
            period = trades_between(trades, first, last)
            row.update({f"{key}_{name}": value for key, value in full_metrics(period, first, last).items()})
        rows.append(row)
    pd.DataFrame(rows).to_csv(OUTPUT_FOLDER / f"all_tests_{market}.csv", index=False)


def main():
    """This function runs the real prices and the shuffled histories in parallel and saves the luck table."""
    shuffled_count = int(sys.argv[1]) if len(sys.argv) > 1 else SHUFFLED_HISTORIES
    jobs = [(market, None) for market in MARKETS] + [(market, seed) for seed in range(shuffled_count) for market in MARKETS]
    OUTPUT_FOLDER.mkdir(exist_ok=True)
    with Pool(WORKERS) as pool:
        summaries = pool.map(search_history, jobs, chunksize=1)
    pd.DataFrame(summaries).to_csv(OUTPUT_FOLDER / "luck_table.csv", index=False)


if __name__ == "__main__":
    main()
