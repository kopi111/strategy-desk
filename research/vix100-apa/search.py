"""Searches APA settings on Volatility 100 and Volatility 100 (1s), with a luck check.

How the test stays honest:
  * Settings are chosen using period A only (Nov 2025 - Jun 2026). Period B (Jul - Nov 2026) only scores the choice.
  * Spread is charged on every trade.
  * The whole search is repeated on shuffled candles, where no pattern can exist. That shows how good the "best of
    1,080" looks by pure luck, so the real best can be compared with it.

Run:  python3 search.py            (real data + 32 shuffled histories, about 30 minutes)
      python3 search.py 2          (real data + 2 shuffled histories, for a quick check)
"""
import itertools
import math
import multiprocessing
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
RESEARCH = HERE.parent
sys.path.insert(0, str(RESEARCH / "apa-15m-5m-confirm"))
sys.path.insert(0, str(RESEARCH / "cinco-apa"))
from apa_setups import find_setups  # noqa: E402
from backtest import resample  # noqa: E402
from backtest_mtf import run  # noqa: E402
from study import load_vix_5m, t_value  # noqa: E402
from watch_signals import SYNTHETICS  # noqa: E402

OUTPUT = HERE / "output"
MARKETS = ("R_100", "1HZ100V")
TRACKS = {"R_100": ("R_100",), "1HZ100V": ("1HZ100V",), "both": MARKETS}
SPLIT = pd.Timestamp("2026-07-01")
SHUFFLED_HISTORIES = 32
WORKERS = 8
# A setting needs this many period-A trades in each market it covers, or its result is too thin to choose.
MINIMUM_TRADES_PER_MARKET = 40
SETUP_CANDLES_TO_CONFIRM = 3

TIMEFRAMES = {"15m": 15, "30m": 30, "1H": 60, "2H": 120, "4H": 240}
GRID = dict(model=("sweep", "sbr_rbs", "qm"), timeframe=tuple(TIMEFRAMES), confirm=("break", "choch", "engulf"),
            rr=(1.0, 1.5, 2.0, 3.0), stop_atr=(0.0, 0.5, 1.0), daily_ema=(0, 50))


def every_setting():
    """Lists every combination of the grid as one dictionary each."""
    return [dict(zip(GRID, values)) for values in itertools.product(*GRID.values())]


def shuffled_candles(candles, seed):
    """Rebuilds the history with its 5m candles in random order, which removes any pattern between candles."""
    random = np.random.default_rng(seed)
    opens = candles.o.to_numpy()
    # Each candle is kept as moves relative to its own open, so its shape and size survive the shuffle.
    relative = np.column_stack([candles[column].to_numpy() / opens for column in "hlc"])[random.permutation(len(opens))]
    # Each candle opens where the one before it closed, as a continuous market does.
    new_opens = opens[0] * np.cumprod(np.concatenate(([1.0], relative[:-1, 2])))
    return pd.DataFrame({"o": new_opens, "h": new_opens * relative[:, 0], "l": new_opens * relative[:, 1],
                         "c": new_opens * relative[:, 2]}, index=candles.index)


def load_history(seed):
    """Loads both markets' 5m candles; a seed of None means real prices, anything else means shuffled."""
    histories = {}
    for offset, market in enumerate(MARKETS):
        candles = load_vix_5m(market)
        histories[market] = candles if seed is None else shuffled_candles(candles, seed * 1000 + offset)
    return histories


def setups_for_history(histories):
    """Finds every model's setups once per timeframe, so the grid can reuse them."""
    setups = {}
    for market, candles in histories.items():
        for timeframe, minutes in TIMEFRAMES.items():
            bars = resample(candles, f"{minutes}min")
            for model in GRID["model"]:
                setups[market, model, timeframe] = find_setups(bars, model, pd.Timedelta(minutes=minutes))
    return setups


def trades_for(market, candles, setups, setting):
    """Runs the existing 5m trade engine for one market and one setting."""
    # The engine counts its confirmation window in 15-minute steps.
    window = SETUP_CANDLES_TO_CONFIRM * TIMEFRAMES[setting["timeframe"]] / 15
    found = setups[market, setting["model"], setting["timeframe"]]
    trades = run(candles, found, confirm=setting["confirm"], window15=window, rr=setting["rr"],
                 stop_atr=setting["stop_atr"], daily_ema=setting["daily_ema"], spread=SYNTHETICS[market][0])
    # An empty list has no usable dates, so give it a date type before anyone filters on it.
    trades["entry_time"] = pd.to_datetime(trades["entry_time"])
    trades["market"] = market
    return trades


def score_period(results, label):
    """Adds up one period's trades into a count, net R, win rate and t value."""
    net = results.net_R
    return {f"trades_{label}": len(net), f"net_R_{label}": round(net.sum(), 2), f"t_{label}": round(t_value(net), 3),
            f"win_{label}": round((results.gross_R > 0).mean() * 100, 1) if len(net) else 0.0}


def score_track(results):
    """Scores period A and period B, and period B again as if the spread were twice as large."""
    before = results[results.entry_time < SPLIT]
    after = results[results.entry_time >= SPLIT]
    # net_R already paid one spread, so paying a second one just subtracts it again.
    doubled = (after.net_R - after.gross_R + after.net_R).sum()
    return {**score_period(before, "A"), **score_period(after, "B"), "net_R_B_double_spread": round(doubled, 2)}


def search_history(seed):
    """Runs the full grid on one history and returns one row per setting per track."""
    histories = load_history(seed)
    setups = setups_for_history(histories)
    rows = []
    for setting in every_setting():
        by_market = {market: trades_for(market, histories[market], setups, setting) for market in MARKETS}
        for track, members in TRACKS.items():
            results = pd.concat([by_market[member] for member in members])
            rows.append({"seed": -1 if seed is None else seed, "track": track, **setting, **score_track(results)})
    print(f"finished history {'REAL' if seed is None else seed}", flush=True)
    return pd.DataFrame(rows)


def best_in_period_a(table, track):
    """Returns the row with the best period-A t value among settings with enough trades."""
    needed = MINIMUM_TRADES_PER_MARKET * len(TRACKS[track])
    eligible = table[(table.track == track) & (table.trades_A >= needed)]
    if eligible.empty:
        raise ValueError(f"No setting has {needed} period-A trades on {track}")
    return eligible.loc[eligible.t_A.idxmax()]


def luck_table(table):
    """One row per history and track, showing what the search would have picked and how that pick then did."""
    rows = []
    for seed, history in table.groupby("seed"):
        for track in TRACKS:
            pick = best_in_period_a(history, track)
            rows.append(dict(seed=seed, track=track, t_A=pick.t_A, net_R_A=pick.net_R_A, t_B=pick.t_B, net_R_B=pick.net_R_B))
    return pd.DataFrame(rows)


def share_at_least(values, threshold):
    """Fraction of shuffled histories at or above the real result, counting the real one so it is never zero."""
    return (1 + (values >= threshold).sum()) / (1 + len(values))


def print_summary(real, luck):
    """Prints each track's real pick beside what shuffled candles produced."""
    for track in TRACKS:
        pick = best_in_period_a(real, track)
        shuffled = luck[(luck.track == track) & (luck.seed >= 0)]
        print(f"\n== {track} ==\n{pick.to_string()}")
        print(f"shuffled best t_A: median {shuffled.t_A.median():.2f}, max {shuffled.t_A.max():.2f}  |  "
              f"luck share (t_A): {share_at_least(shuffled.t_A, pick.t_A):.3f}")
        print(f"shuffled picks in B: median t {shuffled.t_B.median():.2f}, median R {shuffled.net_R_B.median():.1f}  |  "
              f"luck share (t_B): {share_at_least(shuffled.t_B, pick.t_B):.3f}")
        grid = real[real.track == track]
        print(f"settings making money: period A {(grid.net_R_A > 0).mean():.1%}, period B {(grid.net_R_B > 0).mean():.1%}, "
              f"both {((grid.net_R_A > 0) & (grid.net_R_B > 0)).mean():.1%}")


def price_randomness_check():
    """Tests whether 5m closes show any memory: autocorrelation, and variance ratios that should be close to 1."""
    for market in MARKETS:
        closes = load_vix_5m(market).c
        returns = np.log(closes).diff().dropna()
        count = len(returns)
        # A random series has autocorrelation near 0, within about 2/sqrt(count).
        print(f"\n{market}: lag-1 autocorrelation {returns.autocorr():+.4f} (random band +/-{2 / math.sqrt(count):.4f})")
        for candles in (3, 12, 48, 288):
            # Variance of a longer move divided by the variance a random walk would predict.
            ratio = np.log(closes).diff(candles).dropna().var() / (candles * returns.var())
            print(f"   variance ratio over {candles} candles: {ratio:.3f}")


def main():
    """Runs real and shuffled histories, then saves and prints the comparison."""
    shuffled_count = int(sys.argv[1]) if len(sys.argv) > 1 else SHUFFLED_HISTORIES
    OUTPUT.mkdir(exist_ok=True)
    price_randomness_check()
    # None is the real history; the numbers are the shuffled ones.
    with multiprocessing.get_context("fork").Pool(WORKERS) as pool:
        tables = pool.map(search_history, [None, *range(shuffled_count)], chunksize=1)
    table = pd.concat(tables, ignore_index=True)
    real = table[table.seed == -1]
    luck = luck_table(table)
    real.to_csv(OUTPUT / "real_grid.csv", index=False)
    luck.to_csv(OUTPUT / "luck_table.csv", index=False)
    print_summary(real, luck)


if __name__ == "__main__":
    main()
