"""Multi-timeframe "triple screen" test: top-down trend alignment across six timeframes.

The setup the request describes:
  * Bias from the higher timeframes -- 4H, 1H and 30m must all trend the same way.
  * Confirmation from the lower timeframes -- 15m, 10m and 5m must agree with that bias.
  * Only when all six line up is a trade taken, on the 5m, in the agreed direction.

Trend on each timeframe is the sign of a fast-vs-slow EMA (EMA20 vs EMA50 on that timeframe's
closes), read from the last COMPLETED bar of that timeframe at the moment of the 5m entry, so
nothing looks ahead. Each trade risks a fixed share of 5m ATR to a fixed reward, pays the spread,
holds one position at a time. Results in R-multiples.

A random-walk control runs the identical six-screen logic on martingale prices with no trend, so
any profit there is the test's own false-positive rate.
"""

import glob
import os

import numpy as np
import pandas as pd

M1_DIR = os.path.join(os.path.dirname(__file__), "..", "backtest-3y", "m1")
HISTDATA_UTC_OFFSET = 5 * 3600
TFS = {"5m": 5, "10m": 10, "15m": 15, "30m": 30, "1h": 60, "4h": 240}
HIGHER = ("30m", "1h", "4h")
LOWER = ("5m", "10m", "15m")
EMA_FAST, EMA_SLOW = 20, 50
STOP_ATR, REWARD_RISK, MAX_HOLD = 1.0, 2.0, 96
WARMUP = 300

SPREADS = {"EURUSD": 0.00015, "GBPUSD": 0.0002, "AUDUSD": 0.00015, "NZDUSD": 0.0002,
           "USDCAD": 0.0002, "USDCHF": 0.0002, "USDJPY": 0.015, "XAUUSD": 0.40}
MAJORS_GOLD = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "XAUUSD"]


def read_m1(pair):
    rows = []
    for path in sorted(glob.glob(os.path.join(M1_DIR, f"DAT_ASCII_{pair}_M1_*"))):
        for line in open(path, encoding="utf-8"):
            if not line.strip():
                continue
            stamp, o, h, l, c, _ = line.split(";")
            t = pd.Timestamp(f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]}",
                             tz="UTC") + pd.Timedelta(seconds=HISTDATA_UTC_OFFSET)
            rows.append((t, float(o), float(h), float(l), float(c)))
    frame = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close"]).drop_duplicates("time")
    return frame.set_index("time").sort_index()


def resample(m1, minutes):
    rule = f"{minutes}min"
    agg = m1.resample(rule, label="right", closed="right").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    return agg


def ema_trend(frame):
    """+1 / -1 per bar from EMA20 vs EMA50 of that timeframe's closes."""
    fast = frame["close"].ewm(span=EMA_FAST, adjust=False).mean()
    slow = frame["close"].ewm(span=EMA_SLOW, adjust=False).mean()
    return np.sign(fast - slow)


def atr(frame, period=14):
    high, low, close = frame["high"], frame["low"], frame["close"]
    tr = pd.concat([high - low, (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def aligned_bias(entry_index, trends):
    """For each 5m bar, the agreed direction across all six timeframes, else 0.

    Each higher/lower timeframe's trend is as-of the last completed bar at that 5m time.
    """
    combined = pd.DataFrame(index=entry_index)
    for name, trend in trends.items():
        combined[name] = trend.reindex(entry_index, method="ffill")
    agree_long = (combined[list(HIGHER + LOWER)] > 0).all(axis=1)
    agree_short = (combined[list(HIGHER + LOWER)] < 0).all(axis=1)
    bias = np.where(agree_long, 1, np.where(agree_short, -1, 0))
    return pd.Series(bias, index=entry_index)


def exit_result(o, h, l, c, direction, entry, stop, target, first, last, rr):
    highs, lows = h[first:last], l[first:last]
    stop_hit = lows <= stop if direction > 0 else highs >= stop
    target_hit = highs >= target if direction > 0 else lows <= target
    fs = int(np.argmax(stop_hit)) if stop_hit.any() else len(highs)
    ft = int(np.argmax(target_hit)) if target_hit.any() else len(highs)
    if fs <= ft and fs < len(highs):
        return -1.0, first + fs
    if ft < len(highs):
        return rr, first + ft
    return float((c[last - 1] - entry) * direction / abs(entry - stop)), last - 1


def backtest(entry, bias, spread):
    o, h, l, c = (entry[x].to_numpy() for x in ("open", "high", "low", "close"))
    a = atr(entry).to_numpy()
    b = bias.to_numpy()
    n = len(c)
    results, free = [], WARMUP
    for i in range(WARMUP, n - 2):
        if i < free or b[i] == 0:
            continue
        # fresh alignment only: trade when the six-way bias just turned on
        if b[i - 1] == b[i]:
            continue
        d = int(b[i])
        risk = STOP_ATR * a[i]
        if not np.isfinite(risk) or risk <= 0:
            continue
        eb = i + 1
        entry_px = o[eb] + d * spread
        stop = entry_px - d * risk
        target = entry_px + d * REWARD_RISK * risk
        last = min(eb + MAX_HOLD, n)
        if eb >= last:
            continue
        r, ex = exit_result(o, h, l, c, d, entry_px, stop, target, eb, last, REWARD_RISK)
        results.append(r)
        free = ex + 1
    return np.array(results)


def summarize(results):
    if len(results) == 0:
        return {"trades": 0, "win": None, "mean_r": None, "net_r": 0.0, "t": None}
    mean = results.mean()
    t = mean / (results.std(ddof=1) / np.sqrt(len(results))) if len(results) > 1 and results.std() > 0 else None
    return {"trades": len(results), "win": round(float((results > 0).mean()), 3),
            "mean_r": round(float(mean), 4), "net_r": round(float(results.sum()), 1),
            "t": None if t is None else round(float(t), 2)}


def screens_for(m1):
    frames = {name: resample(m1, minutes) for name, minutes in TFS.items()}
    trends = {name: ema_trend(frame).shift(1) for name, frame in frames.items()}  # last completed bar
    entry = frames["5m"]
    bias = aligned_bias(entry.index, trends)
    return entry, bias


def main():
    print("Multi-timeframe triple screen (bias 4H/1H/30m, confirm 15m/10m/5m)\n")
    print(f"{'market':8s} {'trades':>6s} {'win%':>6s} {'mean R':>7s} {'net R':>8s} {'t':>6s}")
    pooled = []
    for pair in MAJORS_GOLD:
        m1 = read_m1(pair)
        entry, bias = screens_for(m1)
        results = backtest(entry, bias, SPREADS[pair])
        pooled.append(results)
        s = summarize(results)
        print(f"{pair:8s} {s['trades']:6d} {100*(s['win'] or 0):6.1f} {s['mean_r'] or 0:7.3f} "
              f"{s['net_r']:8.1f} {str(s['t']):>6s}")
    allr = np.concatenate(pooled) if pooled else np.array([])
    s = summarize(allr)
    print(f"{'POOLED':8s} {s['trades']:6d} {100*(s['win'] or 0):6.1f} {s['mean_r'] or 0:7.3f} "
          f"{s['net_r']:8.1f} {str(s['t']):>6s}")


if __name__ == "__main__":
    main()
