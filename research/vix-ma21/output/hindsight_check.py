"""This script asks: on shuffled prices, how good is the best of the 192 settings in hindsight?"""
import sys
from multiprocessing import Pool
sys.path.insert(0, "..")
import numpy as np, pandas as pd
from ma21_test import run_every_setting, MARKETS, SHUFFLED_SEED_BASE
from search import load_candles, shuffled_candles, boundaries, trades_between
from metrics import t_value

def best_in_hindsight(job):
    """This function returns the best whole-year R, its t, and how many settings won both halves."""
    market, seed = job
    real = load_candles(market)
    candles = real if seed is None else shuffled_candles(real, SHUFFLED_SEED_BASE * (seed + 1) + MARKETS.index(market))
    start, split, end = boundaries(candles)
    totals, both, best_t = [], 0, 0
    for trades in run_every_setting(candles).values():
        a, b = trades_between(trades, start, split).net_r.sum(), trades_between(trades, split, end).net_r.sum()
        totals.append(a + b); both += (a > 0) and (b > 0)
        best_t = max(best_t, t_value(trades.net_r))
    return market, seed, max(totals), best_t, both

jobs = [(m, None) for m in MARKETS] + [(m, s) for s in range(40) for m in MARKETS]
with Pool(8) as pool:
    rows = pd.DataFrame(pool.map(best_in_hindsight, jobs), columns=["market", "seed", "best_R", "best_t", "won_both_halves"])
rows.to_csv("hindsight_luck.csv", index=False)
for m in MARKETS:
    d = rows[rows.market == m]; real = d[d.seed.isna()].iloc[0]; sh = d[d.seed.notna()]
    print(m, f"real best {real.best_R:+.1f}R t{real.best_t:.2f} both-halves {real.won_both_halves}",
          f"| shuffles: best R median {sh.best_R.median():+.1f}, beat real {int((sh.best_R >= real.best_R).sum())}/40,",
          f"t beat real {int((sh.best_t >= real.best_t).sum())}/40, both-halves median {sh.won_both_halves.median():.0f}")
