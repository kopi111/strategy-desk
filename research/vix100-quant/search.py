"""The search: every setting on real prices, then the same search on shuffled prices as a luck check.

The method is fixed here before any result is seen:
  * Period A (start to 30 Jun 2026) is the only data used to rank and choose.
  * Period B (1 Jul 2026 to the end) only scores what A chose.
  * Walk-forward repeats the choice several times, each time trading only the following unseen window.
  * Shuffled histories have the same candles in random order, so any "edge" found in them is pure luck.

Run:  python3 search.py        (real prices + 40 shuffled histories)
      python3 search.py 2      (real prices + 2 shuffled histories, as a quick check)
"""
import json
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import pandas as pd

from engine import CandleArrays, simulate
from metrics import full_metrics, regime_totals, robustness_score, t_value
from rules import STOP_ATR_MULTIPLES, average_true_range, build_bars, every_setting, signals_for

HERE = Path(__file__).parent
DATA_FOLDER = HERE / "data"
OUTPUT_FOLDER = HERE / "output"

MARKETS = ("R_100", "1HZ100V")
SHUFFLED_HISTORIES = 40
WORKERS = 8
# An assumed 0.4 spread (js/core/instruments.js) plus 0.1 slippage. Real MT5 spreads are still unverified.
SPREAD = 0.4
SLIPPAGE = 0.1
COST_PER_TRADE = SPREAD + SLIPPAGE
PERIOD_B_START = pd.Timestamp("2026-07-01")
WALK_FORWARD_START = pd.Timestamp("2026-03-01")
WALK_FORWARD_WINDOWS = 5
MINIMUM_TRADES_PERIOD_A = 60
MINIMUM_TRADES_WALK_FORWARD_TRAINING = 30
TREND_LOOKBACK_DAYS = 20
REGIME_THRESHOLD = 0.5
SHUFFLED_SEED_BASE = 1000


def load_candles(market):
    """Reads a market's 5-minute candles, indexed by their UTC start time."""
    candles = pd.read_csv(DATA_FOLDER / f"{market}_5m.csv")
    candles.index = pd.to_datetime(candles.pop("time"), unit="s")
    return candles


def shuffled_candles(candles, seed):
    """Puts the candles in random order, keeping each candle's own shape but destroying any pattern over time."""
    random = np.random.default_rng(seed)
    opens = candles.open.to_numpy()
    relative = np.column_stack([candles[name].to_numpy() / opens for name in ("high", "low", "close")])
    relative = relative[random.permutation(len(opens))]
    # Each new candle opens where the previous one closed, starting from the real first price.
    new_opens = opens[0] * np.concatenate(([1.0], np.cumprod(relative[:-1, 2])))
    return pd.DataFrame({"open": new_opens, "high": new_opens * relative[:, 0], "low": new_opens * relative[:, 1],
                         "close": new_opens * relative[:, 2]}, index=candles.index)


def market_regimes(candles):
    """Labels each candle bull (1), bear (2), sideways (0) or unknown (-1), using only finished earlier days."""
    daily_close = candles.close.resample("1D").last().dropna()
    daily_change = np.log(daily_close).diff()
    expected_move = daily_change.expanding(min_periods=TREND_LOOKBACK_DAYS).std() * np.sqrt(TREND_LOOKBACK_DAYS)
    trend = np.log(daily_close / daily_close.shift(TREND_LOOKBACK_DAYS)) / expected_move
    labels = np.select([trend > REGIME_THRESHOLD, trend < -REGIME_THRESHOLD, trend.notna()], [1, 2, 0], default=-1)
    # Shift one day so that a candle only sees the label from days that have already finished.
    known_labels = pd.Series(labels, index=daily_close.index).shift(1).fillna(-1)
    return known_labels.reindex(candles.index.floor("1D")).fillna(-1).to_numpy().astype(np.int8)


def run_every_setting(candles):
    """Plays all settings over one history and returns their trades, keyed by setting."""
    arrays = CandleArrays.from_candles(candles)
    all_trades = {}
    bars_by_minutes, atr_by_minutes, signal_store = {}, {}, {}
    for setting in every_setting():
        if setting.minutes not in bars_by_minutes:
            bars_by_minutes[setting.minutes] = build_bars(candles, setting.minutes)
            atr_by_minutes[setting.minutes] = average_true_range(bars_by_minutes[setting.minutes])
        bars, atr = bars_by_minutes[setting.minutes], atr_by_minutes[setting.minutes]
        # Many settings differ only in their exit, so each entry signal is only calculated once.
        signal_key = (setting.rule, setting.parameters, setting.minutes, setting.volatility)
        if signal_key not in signal_store:
            signal_store[signal_key] = signals_for(bars, atr, setting.rule, setting.parameters, setting.volatility)
        all_trades[setting] = simulate(arrays, bars.first_candle.to_numpy(), signal_store[signal_key],
                                       atr.to_numpy(), setting.stop_atr, setting.reward_risk, COST_PER_TRADE)
    return all_trades


def trades_between(trades, first_candle, end_candle):
    """Only the trades that were entered inside the stretch of time."""
    return trades.select((trades.entry >= first_candle) & (trades.entry < end_candle))


def best_setting(all_trades, regimes, first_candle, end_candle, minimum_trades):
    """Picks the setting with the highest robustness score, looking only inside the given stretch of time."""
    best, best_score = None, -np.inf
    for setting, trades in all_trades.items():
        period_trades = trades_between(trades, first_candle, end_candle)
        if len(period_trades) < minimum_trades:
            continue
        score = robustness_score(period_trades, regimes, first_candle, end_candle)
        if score > best_score:
            best, best_score = setting, score
    return best, best_score


def walk_forward_cuts(candles):
    """The candle positions that divide the walk-forward windows."""
    start = np.searchsorted(candles.index.values, WALK_FORWARD_START.to_datetime64())
    return np.linspace(start, len(candles), WALK_FORWARD_WINDOWS + 1).astype(int)


def walk_forward(all_trades, regimes, candles):
    """Repeats the choice on all earlier data, then trades only the next unseen window, and joins the results."""
    cuts = walk_forward_cuts(candles)
    folds, joined_results, joined_entries = [], [], []
    for start, end in zip(cuts[:-1], cuts[1:]):
        chosen, _ = best_setting(all_trades, regimes, 0, start, MINIMUM_TRADES_WALK_FORWARD_TRAINING)
        unseen = trades_between(all_trades[chosen], start, end)
        folds.append({"from": str(candles.index[start]), "to": str(candles.index[end - 1]),
                      "setting": chosen.label(), "trades": len(unseen), "net_r": float(unseen.net_r.sum())})
        joined_results.append(unseen.net_r)
        joined_entries.append(unseen.entry)
    return folds, np.concatenate(joined_results), np.concatenate(joined_entries)


def boundaries(candles):
    """The candle positions where the data starts, period B starts, and the data ends."""
    return 0, int(np.searchsorted(candles.index.values, PERIOD_B_START.to_datetime64())), len(candles)


def search_history(job):
    """Runs the whole search on one market and one history, returning what a luck comparison needs."""
    market, seed = job
    real_candles = load_candles(market)
    candles = real_candles if seed is None else shuffled_candles(real_candles, SHUFFLED_SEED_BASE * (seed + 1) + MARKETS.index(market))
    regimes = market_regimes(candles)
    all_trades = run_every_setting(candles)
    start, split, end = boundaries(candles)
    chosen, score = best_setting(all_trades, regimes, start, split, MINIMUM_TRADES_PERIOD_A)
    period_a = trades_between(all_trades[chosen], start, split)
    period_b = trades_between(all_trades[chosen], split, end)
    folds, walk_forward_results, walk_forward_entries = walk_forward(all_trades, regimes, candles)
    summary = {"market": market, "seed": -1 if seed is None else seed, "setting": chosen.label(), "score_A": score,
               "t_A": t_value(period_a.net_r), "net_R_A": float(period_a.net_r.sum()), "trades_A": len(period_a),
               "net_R_B": float(period_b.net_r.sum()), "t_B": t_value(period_b.net_r), "trades_B": len(period_b),
               "net_R_walk_forward": float(walk_forward_results.sum()), "t_walk_forward": t_value(walk_forward_results),
               "trades_walk_forward": len(walk_forward_results)}
    print(f"{market} seed {seed}: score {score:.2f}, B {summary['net_R_B']:+.1f}R, "
          f"walk-forward {summary['net_R_walk_forward']:+.1f}R", flush=True)
    if seed is not None:
        return summary
    return summary, save_real_results(market, candles, regimes, all_trades, chosen, folds, walk_forward_results, walk_forward_entries)


def metrics_row(setting, trades, regimes, candles):
    """One line of the all-tests table: A, B and the whole year for one setting."""
    start, split, end = boundaries(candles)
    row = {"setting": setting.label(), "rule": setting.rule, "minutes": setting.minutes, "stop_atr": setting.stop_atr,
           "reward_risk": setting.reward_risk if setting.reward_risk is not None else "opposite",
           "volatility": setting.volatility}
    for name, first, last in (("A", start, split), ("B", split, end), ("all", start, end)):
        period_trades = trades_between(trades, first, last)
        row.update({f"{key}_{name}": value for key, value in full_metrics(period_trades, first, last).items()})
    period_a = trades_between(trades, start, split)
    row["score_A"] = robustness_score(period_a, regimes, start, split)
    return row


def trades_table(trades, regimes, candles, split):
    """A readable list of one strategy's trades, for the charts and for checking by hand."""
    return pd.DataFrame({"entry_time": candles.index[trades.entry], "exit_time": candles.index[trades.exit],
                         "side": np.where(trades.side > 0, "buy", "sell"), "net_r": trades.net_r, "cost_r": trades.cost_r,
                         "regime": pd.Series(regimes[trades.entry]).map({0: "sideways", 1: "bull", 2: "bear", -1: "unknown"}).to_numpy(),
                         "period": np.where(trades.entry < split, "A", "B")})


def save_real_results(market, candles, regimes, all_trades, chosen, folds, walk_forward_results, walk_forward_entries):
    """Writes every table for the real prices and returns the summary of the chosen strategy."""
    start, split, end = boundaries(candles)
    table = pd.DataFrame([metrics_row(setting, trades, regimes, candles) for setting, trades in all_trades.items()])
    table.insert(0, "market", market)
    table.to_csv(OUTPUT_FOLDER / f"all_tests_{market}.csv", index=False)
    trades_table(all_trades[chosen], regimes, candles, split).to_csv(OUTPUT_FOLDER / f"chosen_trades_{market}.csv", index=False)
    pd.DataFrame({"entry_time": candles.index[walk_forward_entries], "net_r": walk_forward_results}).to_csv(
        OUTPUT_FOLDER / f"walk_forward_trades_{market}.csv", index=False)
    return {"market": market, "chosen": chosen.label(), "folds": folds,
            "regimes": regime_totals(all_trades[chosen], regimes),
            "buys_net_r": float(all_trades[chosen].net_r[all_trades[chosen].side > 0].sum()),
            "sells_net_r": float(all_trades[chosen].net_r[all_trades[chosen].side < 0].sum()),
            "buy_hold_percent_A": percent_change(candles, start, split), "buy_hold_percent_B": percent_change(candles, split, end),
            "settings_tested": len(all_trades), "first_candle": str(candles.index[0]), "last_candle": str(candles.index[-1]),
            "split": str(candles.index[split]), "stop_multiples": list(STOP_ATR_MULTIPLES)}


def percent_change(candles, first, end):
    """Buy-and-hold return over a stretch of time, for comparison."""
    return float((candles.close.iloc[end - 1] / candles.open.iloc[first] - 1) * 100)


def main():
    """Runs real prices first, then the shuffled histories in parallel, and saves the comparison."""
    shuffled_count = int(sys.argv[1]) if len(sys.argv) > 1 else SHUFFLED_HISTORIES
    jobs = [(market, None) for market in MARKETS] + [(market, seed) for seed in range(shuffled_count) for market in MARKETS]
    OUTPUT_FOLDER.mkdir(exist_ok=True)
    with Pool(WORKERS) as pool:
        results = pool.map(search_history, jobs, chunksize=1)
    real_results = [result for result in results if isinstance(result, tuple)]
    summaries = [result[0] if isinstance(result, tuple) else result for result in results]
    pd.DataFrame(summaries).to_csv(OUTPUT_FOLDER / "luck_table.csv", index=False)
    (OUTPUT_FOLDER / "chosen.json").write_text(json.dumps([detail for _, detail in real_results], indent=2))


if __name__ == "__main__":
    main()
