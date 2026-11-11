"""Win-rate ideas, round 2. Each idea is judged on half A (2023-10..2025-03), then checked on half B.
Base: confirmation break(1), RR 1.5, stop at sweep extreme, gold + 7 forex."""
import math
import numpy as np, pandas as pd
from backtest import load_m1, resample, SPREADS, DEFAULT_SPREAD, MINTICK
from confirm import run

FX = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF"]
SPLIT = pd.Timestamp("2025-04-01")
LONDON_NY = set(range(7, 17))  # UTC hours 07:00-16:59

IDEAS = {
    "base": {},
    "stop+0.25ATR": dict(stop_buffer_atr=0.25),
    "stop+0.5ATR": dict(stop_buffer_atr=0.5),
    "BE at 1R": dict(breakeven_at=1.0),
    "daily EMA50": dict(daily_ema=50),
    "daily EMA20": dict(daily_ema=20),
    "London+NY": dict(sessions=LONDON_NY),
    "RR1.2": dict(rr=1.2),
    "swing3": dict(swing=3),
    "swing8": dict(swing=8),
}


def score(t):
    n = t.net_R
    if len(n) < 3: return dict(trades=len(n))
    return dict(trades=len(n), win=round((t.gross_R > 0.05).mean() * 100, 1),
                loss=round((t.gross_R < -0.05).mean() * 100, 1),
                net_R=round(n.sum(), 1), avg_R=round(n.mean(), 3),
                t=round(n.mean() / n.std() * math.sqrt(len(n)), 2),
                mkts_pos=int((t.groupby("market").net_R.sum() > 0).sum()))


def backtest(data, tf, **kw):
    kw = {"rr": 1.5, **kw}
    ts = []
    for s in FX:
        t = run(data[(s, tf)], confirm="break", window=1, spread=SPREADS.get(s, DEFAULT_SPREAD),
                mintick=MINTICK.get(s, 1e-5), **kw)
        t["market"] = s; ts.append(t)
    return pd.concat(ts)


def main():
    data = {}
    for s in FX:
        m1 = load_m1(s)
        for tf, rule in [("1H", "1h"), ("2H", "2h"), ("4H", "4h")]:
            data[(s, tf)] = resample(m1, rule)
    rows = []
    for tf in ["1H", "2H", "4H"]:
        for name, kw in IDEAS.items():
            t = backtest(data, tf, **kw)
            a, b = t[t.entry_time < SPLIT], t[t.entry_time >= SPLIT]
            row = dict(tf=tf, idea=name, **{f"A_{k}": v for k, v in score(a).items()},
                       **{f"B_{k}": v for k, v in score(b).items()})
            rows.append(row); print(row, flush=True)
    pd.DataFrame(rows).to_csv("output/winrate2.csv", index=False)


if __name__ == "__main__":
    main()
