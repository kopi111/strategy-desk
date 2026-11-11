"""CINCO APA with a confirmation candle before entry.

After a hidden-invalidation signal (sweep of the invalidation level that closes back inside),
the trade is NOT taken on that candle. It waits up to `window` candles for confirmation:
  break   : a candle closes beyond the signal candle's high (buy) / low (sell), in the trade's colour
  engulf  : a candle whose body engulfs the previous candle's body, in the trade's colour
The setup is cancelled if price closes past the signal candle's far end (sweep low/high) first.
Entry = confirmation candle's close. Stop = sweep extreme (lowest low / highest high since the signal).
`instant_stop` places the stop + target on the entry bar itself (fixes the original's one-bar gap).
"""
import math, sys
import numpy as np
import pandas as pd
from backtest import (load_m1, load_deriv, resample, pivots, exit_on_bar,
                      SPREADS, DEFAULT_SPREAD, MINTICK)


def is_confirmed(kind, side, o, h, l, c, i, sig_high, sig_low):
    bull, bear = c[i] > o[i], c[i] < o[i]
    if kind == "break":
        return (bull and c[i] > sig_high) if side > 0 else (bear and c[i] < sig_low)
    if kind == "engulf":
        top, bot = max(o[i - 1], c[i - 1]), min(o[i - 1], c[i - 1])
        return (bull and c[i] >= top and o[i] <= bot) if side > 0 else (bear and c[i] <= bot and o[i] >= top)
    return True


def run(df, confirm="break", window=3, instant_stop=True, rr=2.0, swing=5, spread=DEFAULT_SPREAD, mintick=1e-5, trend_ema=0,
        stop_buffer_atr=0.0, breakeven_at=0.0, daily_ema=0, sessions=None, events=None):
    o, h, l, c = (df[k].to_numpy() for k in "ohlc")
    # optional trend filter: only buy above / sell below the EMA
    ema = df.c.ewm(span=trend_ema, adjust=False).mean().to_numpy() if trend_ema else None
    # 14-bar ATR, used to push the stop a little past the sweep
    tr = np.maximum(h - l, np.maximum(abs(h - np.roll(c, 1)), abs(l - np.roll(c, 1))))
    atr = pd.Series(tr).rolling(14).mean().to_numpy()
    # daily trend: EMA of daily closes, yesterday's value only (no look-ahead)
    day_ema = None
    if daily_ema:
        daily = df.c.resample("1D").last().dropna().ewm(span=daily_ema, adjust=False).mean().shift(1)
        day_ema = daily.reindex(df.index.floor("1D")).to_numpy()
    hours = df.index.hour.to_numpy()
    initial_risk = math.nan
    ph, pl = pivots(h, l, swing)
    last_high = last_low = bull_inv = bear_inv = math.nan
    bull_active = bear_active = False
    position = 0; entry = stop = target = math.nan; exit_live = False; entry_time = None
    pending = None  # dict(side, sig_high, sig_low, extreme, left)
    trades = []

    for i in range(1, len(c)):
        if position != 0 and exit_live:
            price, why = exit_on_bar(position, o[i], h[i], l[i], c[i], stop, target)
            if price is not None:
                trades.append((entry_time, df.index[i], position, entry, price, initial_risk, why))
                position = 0; exit_live = False
            elif breakeven_at and (c[i] - entry) * position >= 0 and \
                    ((h[i] - entry) if position > 0 else (entry - l[i])) >= breakeven_at * initial_risk:
                stop = entry + position * spread  # lock break-even (covers the spread)

        # structure, as in the Pine script
        if not math.isnan(ph[i]): last_high = ph[i]
        if not math.isnan(pl[i]): last_low = pl[i]
        bull_break = not math.isnan(last_high) and c[i] > last_high and c[i - 1] <= last_high
        bear_break = not math.isnan(last_low) and c[i] < last_low and c[i - 1] >= last_low
        if bull_break and not math.isnan(last_low):
            bull_inv = last_low; bull_active = True; bear_active = False
        if bear_break and not math.isnan(last_high):
            bear_inv = last_high; bear_active = True; bull_active = False
        hidden_bull = bull_active and l[i] < bull_inv and c[i] > bull_inv
        hidden_bear = bear_active and h[i] > bear_inv and c[i] < bear_inv
        if bull_active and c[i] < bull_inv: bull_active = False
        if bear_active and c[i] > bear_inv: bear_active = False

        flat = position == 0
        go_side = 0
        # 1) work an existing pending setup
        if pending is not None and flat:
            side = pending["side"]
            pending["extreme"] = min(pending["extreme"], l[i]) if side > 0 else max(pending["extreme"], h[i])
            failed = c[i] < pending["sig_low"] if side > 0 else c[i] > pending["sig_high"]
            if failed:
                pending = None
            elif is_confirmed(confirm, side, o, h, l, c, i, pending["sig_high"], pending["sig_low"]):
                go_side, go_stop = side, pending["extreme"]; pending = None
            else:
                pending["left"] -= 1
                if pending["left"] <= 0: pending = None
        # 2) new signal -> start waiting for confirmation
        if go_side == 0 and flat and pending is None:
            if hidden_bull:
                bull_active = False
                if confirm == "none": go_side, go_stop = 1, l[i]
                else: pending = dict(side=1, sig_high=h[i], sig_low=l[i], extreme=l[i], left=window)
                if events is not None and pending: events.append(dict(kind="setup", time=df.index[i], side=1, high=h[i], low=l[i]))
            elif hidden_bear:
                bear_active = False
                if confirm == "none": go_side, go_stop = -1, h[i]
                else: pending = dict(side=-1, sig_high=h[i], sig_low=l[i], extreme=h[i], left=window)
                if events is not None and pending: events.append(dict(kind="setup", time=df.index[i], side=-1, high=h[i], low=l[i]))

        # original behaviour: exit order only placed on the bar after entry
        if position != 0 and not exit_live:
            risk = (entry - stop) * position
            if risk > mintick:
                target = entry + position * risk * rr; exit_live = True
                if (position > 0 and (c[i] <= stop or c[i] >= target)) or (position < 0 and (c[i] >= stop or c[i] <= target)):
                    trades.append((entry_time, df.index[i], position, entry, c[i], risk, "close"))
                    position = 0; exit_live = False

        if go_side != 0 and ema is not None and (c[i] - ema[i]) * go_side <= 0:
            go_side = 0
        if go_side != 0 and day_ema is not None and not ((c[i] - day_ema[i]) * go_side > 0):
            go_side = 0
        if go_side != 0 and sessions is not None and hours[i] not in sessions:
            go_side = 0
        if go_side != 0 and stop_buffer_atr and not math.isnan(atr[i]):
            go_stop = go_stop - go_side * stop_buffer_atr * atr[i]
        if go_side != 0 and position == 0:
            position, entry, stop, entry_time = go_side, c[i], go_stop, df.index[i]
            risk = (entry - stop) * position
            initial_risk = risk
            exit_live = False
            if instant_stop and risk > mintick:
                target = entry + position * risk * rr; exit_live = True
                if events is not None:
                    events.append(dict(kind="entry", time=df.index[i], side=position, entry=entry, stop=stop, target=target))
            elif risk <= mintick:
                position = 0  # no valid stop: skip

    t = pd.DataFrame(trades, columns=["entry_time", "exit_time", "side", "entry", "exit", "risk", "why"])
    t["gross_R"] = (t.exit - t.entry) * t.side / t.risk
    t["net_R"] = t.gross_R - spread / t.risk
    return t


VARIANTS = {
    "original":             dict(confirm="none",   instant_stop=False),
    "original+instantStop": dict(confirm="none",   instant_stop=True),
    "break(3)":             dict(confirm="break",  window=3),
    "break(1)":             dict(confirm="break",  window=1),
    "break(5)":             dict(confirm="break",  window=5),
    "engulf(3)":            dict(confirm="engulf", window=3),
}


def stats(g):
    n = g.net_R
    if len(n) < 2: return dict(trades=len(n))
    return dict(trades=len(n), win=round((g.gross_R > 0).mean() * 100, 1), gross_R=round(g.gross_R.sum(), 1),
                net_R=round(n.sum(), 1), avg_R=round(n.mean(), 3), t=round(n.mean() / n.std() * math.sqrt(len(n)), 2))


def main():
    fx = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF"]
    data = {}
    for s in fx:
        m1 = load_m1(s)
        for tf, rule in [("15m", "15min"), ("1H", "1h"), ("4H", "4h")]:
            data[(s, tf)] = resample(m1, rule)
    for s in ["R_25", "R_75", "R_100", "stpRNG2"]:
        for tf, sec in [("5m", 300), ("1H", 3600), ("4H", 14400)]:
            data[(s, tf)] = load_deriv(s, sec)
    out = []
    for vname, kw in VARIANTS.items():
        for (s, tf), df in data.items():
            t = run(df, spread=SPREADS.get(s, DEFAULT_SPREAD), mintick=MINTICK.get(s, 1e-5) if s in SPREADS or len(s) == 6 else 0.01, **kw)
            t["market"], t["tf"], t["variant"] = s, tf, vname
            out.append(t)
        print("done", vname, flush=True)
    pd.concat(out).to_csv("output/confirm_trades.csv", index=False)


if __name__ == "__main__":
    main()
