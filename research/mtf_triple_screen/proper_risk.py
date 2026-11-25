"""The validated trend strategy, run on a $10,000 account with proper 1% risk.

Strategy: EMA 20/100 cross on 1h bars (the setting that stayed positive out-of-sample), majors +
gold. Enter on the cross, stop 2*ATR away, exit on the opposite cross or the stop. Each trade risks
1% of the account, so size = 1% of equity / stop distance; results compound. Spread paid per trade.
"""

import glob
import os

import numpy as np
import pandas as pd

M1_DIR = os.path.join(os.path.dirname(__file__), "..", "backtest-3y", "m1")
HISTDATA_UTC_OFFSET = 5 * 3600
SPREADS = {"EURUSD": 0.00015, "GBPUSD": 0.0002, "USDJPY": 0.015, "AUDUSD": 0.00015,
           "USDCAD": 0.0002, "XAUUSD": 0.40}
MARKETS = list(SPREADS)
EMA_FAST, EMA_SLOW, ATR_STOP = 20, 100, 2.0
RISK_PER_TRADE = 0.01
START = 10_000


def read_1h(pair):
    rows = []
    for path in sorted(glob.glob(os.path.join(M1_DIR, f"DAT_ASCII_{pair}_M1_*"))):
        for line in open(path, encoding="utf-8"):
            if not line.strip():
                continue
            stamp, o, h, l, c, _ = line.split(";")
            t = pd.Timestamp(f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]}",
                             tz="UTC") + pd.Timedelta(seconds=HISTDATA_UTC_OFFSET)
            rows.append((t, float(o), float(h), float(l), float(c)))
    f = pd.DataFrame(rows, columns=["time", "o", "h", "l", "c"]).drop_duplicates("time").set_index("time").sort_index()
    return f.resample("1h", label="right", closed="right").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last"}).dropna()


def atr(f, period=14):
    tr = pd.concat([f["h"] - f["l"], (f["h"] - f["c"].shift()).abs(), (f["l"] - f["c"].shift()).abs()],
                   axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def trades_for(pair):
    """Every EMA-cross trade as (exit_time, R_multiple), spread paid."""
    f = read_1h(pair)
    c = f["c"].to_numpy(); o = f["o"].to_numpy(); h = f["h"].to_numpy(); l = f["l"].to_numpy()
    a = atr(f).to_numpy(); t = f.index
    fast = pd.Series(c).ewm(span=EMA_FAST, adjust=False).mean().to_numpy()
    slow = pd.Series(c).ewm(span=EMA_SLOW, adjust=False).mean().to_numpy()
    sign = np.sign(fast - slow)
    spread = SPREADS[pair]
    out = []
    i = 110
    n = len(c)
    while i < n - 1:
        crossed_up = sign[i] > 0 and sign[i - 1] <= 0
        crossed_dn = sign[i] < 0 and sign[i - 1] >= 0
        if not (crossed_up or crossed_dn) or not np.isfinite(a[i]) or a[i] <= 0:
            i += 1
            continue
        d = 1 if crossed_up else -1
        entry = o[i + 1] + d * spread
        stop = entry - d * ATR_STOP * a[i]
        risk = abs(entry - stop)
        exit_price, exit_i = None, None
        for j in range(i + 1, n):
            if (d > 0 and l[j] <= stop) or (d < 0 and h[j] >= stop):
                exit_price, exit_i = stop, j
                break
            if (d > 0 and sign[j] < 0) or (d < 0 and sign[j] > 0):
                exit_price, exit_i = o[j] - d * spread, j
                break
        if exit_price is None:
            exit_price, exit_i = c[-1], n - 1
        out.append((t[exit_i], float((exit_price - entry) * d / risk)))
        i = exit_i + 1
    return out


def main():
    all_trades = []
    per_market = {}
    for pair in MARKETS:
        ts = trades_for(pair)
        per_market[pair] = ts
        all_trades += ts
    all_trades.sort(key=lambda x: x[0])

    # Compound 1% risk per trade on one shared account, in exit-time order.
    equity = START
    curve = []
    for exit_time, R in all_trades:
        equity *= (1 + RISK_PER_TRADE * R)
        curve.append((exit_time, equity))
    span_years = (all_trades[-1][0] - all_trades[0][0]).days / 365.25
    peak = -1e9; maxdd = 0.0
    for _, e in curve:
        peak = max(peak, e); maxdd = min(maxdd, e / peak - 1)
    cagr = (equity / START) ** (1 / span_years) - 1

    print(f"Validated trend strategy — EMA {EMA_FAST}/{EMA_SLOW} on 1h, majors + gold")
    print(f"$10,000 account, 1% risk per trade, compounded, {span_years:.1f} years\n")
    print(f"{'market':8s} {'trades':>6s} {'win%':>6s} {'total R':>8s}")
    for pair, ts in per_market.items():
        rs = np.array([r for _, r in ts])
        print(f"{pair:8s} {len(rs):6d} {100*(rs>0).mean():6.1f} {rs.sum():8.1f}")
    total_r = sum(r for _, r in all_trades)
    print(f"{'ALL':8s} {len(all_trades):6d} {100*np.mean([r>0 for _,r in all_trades]):6.1f} {total_r:8.1f}")
    print(f"\nEnding balance: ${equity:,.0f}   (profit ${equity-START:+,.0f}, {100*(equity/START-1):+.1f}% total)")
    print(f"Annual return (CAGR): {100*cagr:+.1f}%/yr")
    print(f"Worst drawdown: {100*maxdd:.1f}%")
    print(f"\nFlat $100/trade (no compounding): ${START + 100*total_r:,.0f}")


if __name__ == "__main__":
    main()
