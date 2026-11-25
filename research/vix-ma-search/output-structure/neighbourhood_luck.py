"""This script repeats the neighbourhood grid on shuffled prices to see how much of it is positive by luck."""
import sys
from multiprocessing import Pool
sys.path.insert(0, "..")
import numpy as np, pandas as pd
import structure_refine as refine
from search import shuffled_candles

def run(job):
    """This function runs the grid for one market on one shuffled history and returns per-setting year R."""
    market, seed = job
    original = refine.load_candles
    refine.load_candles = lambda m: shuffled_candles(original(m), 9900 * (seed + 1) + refine.MARKETS.index(m))
    rows = refine.run_market(market)
    return seed, np.array([row["R_A"] + row["R_B"] for row in rows])

jobs = [(m, s) for s in range(12) for m in refine.MARKETS]
with Pool(8) as pool:
    out = pool.map(run, jobs)
for seed in range(12):
    total = sum(r for s, r in out if s == seed)
    print(f"shuffle {seed}: positive {100*(total>0).mean():.0f}% of settings, average {total.mean():+.1f}R, best {total.max():+.1f}R", flush=True)
