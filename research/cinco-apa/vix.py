"""Best CINCO APA versions on all 18 Deriv Volatility (Vix) indices, 1 year of 15m candles
(research/fvg-return/data, Nov 2025 - Nov 2026), resampled to 30m / 1H / 2H / 4H."""
import math, re
from pathlib import Path
import pandas as pd
from confirm import run

ROOT = Path(__file__).resolve().parent.parent
SPREAD = {m[0]: float(m[1]) for m in re.findall(r"synthetic\('([^']+)', '[^']+', \d+, [\d.]+, ([\d.]+)",
                                                   (ROOT.parent / "js/core/instruments.js").read_text())}
MARKETS = sorted({p.name.rsplit("_", 1)[0] for p in (ROOT / "fvg-return/data").glob("*_15m.csv")} - {"stpRNG", "stpRNG2", "stpRNG3", "stpRNG4", "stpRNG5"})
# Step 300/400/500 spreads are ASSUMED (0.1 per 100 of step size, like Step 100/200)
SPREAD.update({"stpRNG3": 0.3, "stpRNG4": 0.4, "stpRNG5": 0.5})

VERSIONS = {
    "original (no confirm, RR2)":        ("1H", dict(confirm="none", instant_stop=False, rr=2.0)),
    "15m 65%-style (RR0.5, ATR0.5, dEMA50)": ("15m", dict(rr=0.5, stop_buffer_atr=0.5, daily_ema=50)),
    "30m 65%-style (RR0.5, ATR0.5, dEMA50)": ("30m", dict(rr=0.5, stop_buffer_atr=0.5, daily_ema=50)),
    "1H 69%-style (RR0.5, ATR1, dEMA50)":   ("1H", dict(rr=0.5, stop_buffer_atr=1.0, daily_ema=50)),
    "1H best (RR1.5, ATR0.5, dEMA50)":      ("1H", dict(rr=1.5, stop_buffer_atr=0.5, daily_ema=50)),
    "2H best (RR1.5, ATR0.5, dEMA50)":      ("2H", dict(rr=1.5, stop_buffer_atr=0.5, daily_ema=50)),
    "4H wider stop (RR1.5, ATR0.5)":        ("4H", dict(rr=1.5, stop_buffer_atr=0.5)),
}


def load(sym):
    d = pd.read_csv(ROOT / f"fvg-return/data/{sym}_15m.csv")
    d.index = pd.to_datetime(d.time, unit="s")
    return d.rename(columns={"open": "o", "high": "h", "low": "l", "close": "c"})[["o", "h", "l", "c"]].sort_index()


def main(markets=MARKETS, tag="vix"):
    MARKETS = markets
    frames = {}
    for s in MARKETS:
        m = load(s)
        frames[s] = {"15m": m, **{tf: m.resample(r).agg({"o": "first", "h": "max", "l": "min", "c": "last"}).dropna()
                                  for tf, r in [("30m", "30min"), ("1H", "1h"), ("2H", "2h"), ("4H", "4h")]}}
    rows, all_t = [], []
    for name, (tf, kw) in VERSIONS.items():
        kw = {"confirm": "break", "window": 1, **kw}
        ts = []
        for s in MARKETS:
            t = run(frames[s][tf], spread=SPREAD[s], mintick=1e-6, **kw)
            t["market"] = s; ts.append(t)
        t = pd.concat(ts).sort_values("exit_time"); t["version"] = name; all_t.append(t)
        n = t.net_R; eq = 200.0
        for r in n: eq += eq * 0.01 * r
        rr = kw["rr"]
        rows.append(dict(version=name, trades=len(t), win=round((t.gross_R > 0.05).mean() * 100, 1),
                         need=round(100 / (1 + rr), 1), gross_R=round(t.gross_R.sum(), 1), net_R=round(n.sum(), 1),
                         t=round(n.mean() / n.std() * math.sqrt(len(n)), 2),
                         mkts_pos=f"{int((t.groupby('market').net_R.sum() > 0).sum())}/{len(MARKETS)}",
                         usd_200_at_1pct=round(eq, 2)))
        print(rows[-1], flush=True)
    pd.DataFrame(rows).to_csv(f"output/{tag}_summary.csv", index=False)
    pd.concat(all_t).to_csv(f"output/{tag}_trades.csv", index=False)


if __name__ == "__main__":
    import sys
    main(sys.argv[2:], sys.argv[1]) if len(sys.argv) > 2 else main()
