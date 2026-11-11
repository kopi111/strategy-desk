"""Win-rate sweep: confirmation break(1), target RR and EMA trend filter, gold + forex."""
import math, itertools
import numpy as np, pandas as pd
from backtest import load_m1, resample, SPREADS, DEFAULT_SPREAD, MINTICK
from confirm import run

FX = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF"]
data = {}
for s in FX:
    m1 = load_m1(s)
    for tf, rule in [("1H", "1h"), ("4H", "4h")]:
        data[(s, tf)] = resample(m1, rule)
rows = []
for tf, rr, ema in itertools.product(["1H", "4H"], [1.0, 1.5, 2.0], [0, 50, 200]):
    ts = []
    for s in FX:
        t = run(data[(s, tf)], confirm="break", window=1, rr=rr, trend_ema=ema,
                spread=SPREADS.get(s, DEFAULT_SPREAD), mintick=MINTICK.get(s, 1e-5))
        t["market"] = s; ts.append(t)
    t = pd.concat(ts); n = t.net_R
    half = t.entry_time < pd.Timestamp("2025-04-01")
    rows.append(dict(tf=tf, rr=rr, ema=ema or "-", trades=len(t),
                     win=round((t.gross_R > 0).mean() * 100, 1), breakeven_win=round(100 / (1 + rr), 1),
                     net_R=round(n.sum(), 1), t=round(n.mean() / n.std() * math.sqrt(len(n)), 2),
                     A=round(n[half].sum(), 1), B=round(n[~half].sum(), 1),
                     mkts_pos=int((t.groupby("market").net_R.sum() > 0).sum())))
    print(rows[-1], flush=True)
pd.DataFrame(rows).to_csv("output/winrate_sweep.csv", index=False)
