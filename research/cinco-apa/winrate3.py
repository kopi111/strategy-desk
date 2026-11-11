"""Round 3: can 15m / 30m / 1H reach 65% win and still make money?
Base = confirmation break(1) + daily EMA50 filter. Grid over target RR and stop buffer (ATR)."""
import itertools
import pandas as pd
from backtest import load_m1, resample
from winrate2 import backtest, score, FX, SPLIT

data = {}
for s in FX:
    m1 = load_m1(s)
    for tf, rule in [("15m", "15min"), ("30m", "30min"), ("1H", "1h")]:
        data[(s, tf)] = resample(m1, rule)
rows = []
for tf, rr, buf in itertools.product(["15m", "30m", "1H"], [0.5, 0.75, 1.0], [0.5, 1.0]):
    t = backtest(data, tf, rr=rr, stop_buffer_atr=buf, daily_ema=50)
    a, b = t[t.entry_time < SPLIT], t[t.entry_time >= SPLIT]
    row = dict(tf=tf, rr=rr, buf=buf, **score(t), need=round(100 / (1 + rr), 1),
               gross_R=round(t.gross_R.sum(), 1), A=round(a.net_R.sum(), 1), B=round(b.net_R.sum(), 1),
               A_win=round((a.gross_R > 0.05).mean() * 100, 1), B_win=round((b.gross_R > 0.05).mean() * 100, 1))
    rows.append(row); print(row, flush=True)
pd.DataFrame(rows).to_csv("output/winrate3.csv", index=False)
