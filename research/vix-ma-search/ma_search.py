"""Search for a moving average strategy that works across all 18 Volatility indices, with a luck check.

Method, fixed before any result was seen:
  * Entry rules: price crosses one MA, pullback to one MA, or a fast MA crosses a slow MA (EMA and SMA).
  * Each on 15m / 30m / 1H / 4H, stop 1 / 2 / 3 ATR, exit RR 1 / 2 / 3 or the opposite signal.
  * ONE setting must be chosen for all 18 markets together, by the t value of all their period A trades
    (start to 30 Jun 2026). Period B (1 Jul onward) only scores that choice.
  * The same search on shuffled prices (every market shuffled) shows what luck alone finds.
Costs: each market's spread from js/core/instruments.js plus 25% slippage, scaled to the market's median price.

Run:  python3 ma_search.py [shuffled_histories]     (default 20)
"""
import sys
from dataclasses import dataclass
from multiprocessing import Pool
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

RESEARCH_FOLDER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH_FOLDER / "vix100-quant"))

from engine import CandleArrays, simulate  # noqa: E402
from rules import average_true_range, build_bars, crossed_above, signals_from  # noqa: E402
from search import PERIOD_B_START, shuffled_candles  # noqa: E402

DATA_FOLDER = RESEARCH_FOLDER / "fvg-return" / "data"
OUTPUT_FOLDER = Path(__file__).resolve().parent / "output"
# Spread and reference price per market, copied from js/core/instruments.js.
SPREADS = {"R_10": (0.6, 6000), "R_15": (12.7, 103000), "R_25": (1.2, 2500), "R_30": (38.9, 94800),
           "R_50": (0.05, 200), "R_75": (25, 40000), "R_90": (98.9, 141000), "R_100": (0.4, 1200),
           "1HZ10V": (1.2, 9500), "1HZ15V": (1.7, 13700), "1HZ25V": (374, 911000), "1HZ30V": (2.5, 6170),
           "1HZ50V": (102, 202000), "1HZ75V": (2, 3000), "1HZ90V": (9.3, 30700), "1HZ100V": (0.4, 900),
           "1HZ150V": (0.02, 54), "1HZ250V": (0.00007, 0.24)}
MARKETS = tuple(SPREADS)
SLIPPAGE_SHARE = 0.25
LENGTHS = (5, 8, 9, 10, 13, 20, 21, 30, 34, 50, 55, 89, 100, 144, 200)
PAIRS = ((5, 13), (8, 21), (9, 21), (10, 30), (13, 34), (20, 50), (21, 55), (34, 89), (50, 100), (50, 200),
         (55, 144), (100, 200))
TIMEFRAMES = (15, 30, 60, 240)
STOPS = (1.0, 2.0, 3.0)
TARGETS = (1.0, 2.0, 3.0, None)
SLOPE_LOOKBACK = 5
MINIMUM_POOLED_TRADES_A = 300
SHUFFLED_HISTORIES = 20
SEED_BASE = 7000
WORKERS = 8


@dataclass(frozen=True)
class Setting:
    """This class holds one complete moving average strategy."""
    rule: str
    average: str
    lengths: tuple
    minutes: int
    stop_atr: float
    reward_risk: Optional[float]

    def label(self):
        """This function gives the setting a short readable name."""
        exit_name = "opposite signal" if self.reward_risk is None else f"RR {self.reward_risk:g}"
        lengths = "/".join(str(length) for length in self.lengths)
        return f"{self.rule} {self.average}{lengths} {self.minutes}m stop {self.stop_atr:g} ATR {exit_name}"


def moving_average(close, average, length):
    """This function returns an EMA or SMA of the closes."""
    if average == "EMA":
        return close.ewm(span=length, adjust=False, min_periods=length).mean()
    return close.rolling(length).mean()


def price_cross(bars, average, length):
    """This function buys when the close crosses above the MA and sells when it crosses below."""
    line = moving_average(bars.close, average, length)
    return signals_from(crossed_above(bars.close, line), crossed_above(line, bars.close))


def pullback(bars, average, length):
    """This function buys a green close back above a rising MA after a dip to it, and mirrors it for sells."""
    line = moving_average(bars.close, average, length)
    rising, falling = line > line.shift(SLOPE_LOOKBACK), line < line.shift(SLOPE_LOOKBACK)
    previous_close, previous_line = bars.close.shift(1), line.shift(1)
    buy = rising & (previous_close > previous_line) & (bars.low <= line) & (bars.close > line) & (bars.close > bars.open)
    sell = falling & (previous_close < previous_line) & (bars.high >= line) & (bars.close < line) & (bars.close < bars.open)
    return signals_from(buy, sell)


def pair_cross(bars, average, fast, slow):
    """This function buys when the fast MA crosses above the slow MA and sells on the reverse."""
    fast_line, slow_line = moving_average(bars.close, average, fast), moving_average(bars.close, average, slow)
    return signals_from(crossed_above(fast_line, slow_line), crossed_above(slow_line, fast_line))


RULES = {"cross": price_cross, "pullback": pullback, "pair": pair_cross}


def entry_rules():
    """This function lists every entry rule with its average type and lengths."""
    singles = [(rule, average, (length,)) for rule in ("cross", "pullback") for average in ("EMA", "SMA") for length in LENGTHS]
    pairs = [("pair", average, pair) for average in ("EMA", "SMA") for pair in PAIRS]
    return singles + pairs


def every_setting():
    """This function lists every setting in a fixed order, the same for every market and history."""
    return [Setting(rule, average, lengths, minutes, stop, target) for rule, average, lengths in entry_rules()
            for minutes in TIMEFRAMES for stop in STOPS for target in TARGETS]


def load_candles(market):
    """This function reads a market's saved 5-minute candles, keeping only rows on exact 5-minute marks."""
    candles = pd.read_csv(DATA_FOLDER / f"{market}_5m.csv")
    candles = candles[candles.time % 300 == 0]
    candles.index = pd.to_datetime(candles.pop("time"), unit="s")
    return candles[["open", "high", "low", "close"]]


def cost_per_trade(market, candles):
    """This function turns the market's spread plus slippage into a price amount at its median price."""
    spread, reference_price = SPREADS[market]
    return spread / reference_price * (1 + SLIPPAGE_SHARE) * float(candles.close.median())


def period_statistics(results, in_period_b):
    """This function returns trade count, sum and sum of squares of R for period A and period B."""
    rows = []
    for mask in (~in_period_b, in_period_b):
        chosen = results[mask]
        rows.append((len(chosen), chosen.sum(), (chosen ** 2).sum()))
    return rows


def search_market(job):
    """This function plays every setting on one market and history and returns A/B statistics per setting."""
    market, seed = job
    candles = load_candles(market)
    if seed is not None:
        candles = shuffled_candles(candles, SEED_BASE * (seed + 1) + MARKETS.index(market))
    arrays, cost = CandleArrays.from_candles(candles), cost_per_trade(market, candles)
    split = int(np.searchsorted(candles.index.values, PERIOD_B_START.to_datetime64()))
    bars_by_minutes, signal_store, statistics = {}, {}, []
    for setting in every_setting():
        if setting.minutes not in bars_by_minutes:
            bars = build_bars(candles, setting.minutes)
            bars_by_minutes[setting.minutes] = (bars, average_true_range(bars).to_numpy())
        bars, atr = bars_by_minutes[setting.minutes]
        key = (setting.rule, setting.average, setting.lengths, setting.minutes)
        if key not in signal_store:
            signal_store[key] = RULES[setting.rule](bars, setting.average, *setting.lengths)
        trades = simulate(arrays, bars.first_candle.to_numpy(), signal_store[key], atr, setting.stop_atr,
                          setting.reward_risk, cost)
        statistics.append(period_statistics(trades.net_r, trades.entry >= split))
    return market, seed, np.array(statistics, dtype=float)


def pooled_t(count, total, squares):
    """This function returns the t value of pooled trades from their count, sum and sum of squares."""
    mean = np.divide(total, count, out=np.zeros_like(total), where=count > 1)
    variance = np.divide(squares - count * mean ** 2, count - 1, out=np.zeros_like(total), where=count > 1)
    deviation = np.sqrt(np.clip(variance, 0, None))
    return np.divide(mean * np.sqrt(count), deviation, out=np.zeros_like(total), where=deviation > 0)


def choose_and_score(pooled):
    """This function picks the setting with the best pooled period A t value and scores it on period B."""
    t_a = pooled_t(*pooled[:, 0, :].T)
    t_a[pooled[:, 0, 0] < MINIMUM_POOLED_TRADES_A] = -np.inf
    best = int(np.argmax(t_a))
    t_b = pooled_t(*pooled[:, 1, :].T)
    return best, t_a[best], pooled[best, 0, 1], pooled[best, 1, 1], t_b[best], int(pooled[best, 1, 0])


def main():
    """This function runs real and shuffled histories, chooses one setting per history and saves the tables."""
    shuffled_count = int(sys.argv[1]) if len(sys.argv) > 1 else SHUFFLED_HISTORIES
    seeds = [None] + list(range(shuffled_count))
    jobs = [(market, seed) for seed in seeds for market in MARKETS]
    OUTPUT_FOLDER.mkdir(exist_ok=True)
    with Pool(WORKERS) as pool:
        results = pool.map(search_market, jobs, chunksize=1)
    settings = every_setting()
    by_seed = {seed: {market: stats for market, s, stats in results if s == seed} for seed in seeds}
    save_real_tables(settings, by_seed[None])
    luck_rows = []
    for seed in seeds:
        pooled = sum(by_seed[seed].values())
        best, t_a, net_a, net_b, t_b, trades_b = choose_and_score(pooled)
        luck_rows.append({"seed": -1 if seed is None else seed, "setting": settings[best].label(), "t_A": t_a,
                          "net_R_A": net_a, "net_R_B": net_b, "t_B": t_b, "trades_B": trades_b,
                          "markets_positive_B": int(sum(stats[best, 1, 1] > 0 for stats in by_seed[seed].values()))})
        print(luck_rows[-1], flush=True)
    pd.DataFrame(luck_rows).to_csv(OUTPUT_FOLDER / "luck_table.csv", index=False)


def save_real_tables(settings, market_statistics):
    """This function writes every setting's pooled and per-market results on the real prices."""
    pooled = sum(market_statistics.values())
    table = pd.DataFrame({"setting": [setting.label() for setting in settings],
                          "trades_A": pooled[:, 0, 0], "net_R_A": pooled[:, 0, 1], "t_A": pooled_t(*pooled[:, 0, :].T),
                          "trades_B": pooled[:, 1, 0], "net_R_B": pooled[:, 1, 1], "t_B": pooled_t(*pooled[:, 1, :].T)})
    for market, stats in market_statistics.items():
        table[f"R_A_{market}"], table[f"R_B_{market}"] = stats[:, 0, 1], stats[:, 1, 1]
    table.to_csv(OUTPUT_FOLDER / "all_settings_real.csv", index=False)


if __name__ == "__main__":
    main()
