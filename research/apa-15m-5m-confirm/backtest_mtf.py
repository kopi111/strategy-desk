"""APA (CINCO APA) with the SETUP on 15m and the CONFIRMATION candle on 5m.

Rules (strategy-improvement-prompt.txt, 2026-11-06):
  * 15m setup = the CINCO APA hidden-invalidation signal: after a structure break, a candle sweeps the
    invalidation level and closes back inside. Only known once that 15m candle has CLOSED.
  * Wait for a 5m confirmation candle that closes AFTER the setup candle closed:
        break  - 5m candle in the trade's colour closes past the 15m sweep candle's high (buy) / low (sell)
        choch  - 5m candle in the trade's colour closes past the last confirmed 5m swing high / low
        engulf - 5m candle in the trade's colour whose body engulfs the previous 5m body
  * The setup expires after `window15` more 15m candles; cancelled if a 5m candle closes past the
    sweep candle's far end first.
  * Entry = 5m confirmation close. Stop = sweep extreme since the setup (+ optional ATR buffer).
    Target = rr x risk. Stop and target are live from the next 5m candle (TradingView OHLC path).
  * Optional filters: yesterday's daily EMA trend, trading hours (UTC).
  * Optional trade management (for a higher win rate):
        be_at      - once price reaches be_at x risk, move the stop to entry + spread (break-even)
        partial_at - close `partial_size` of the trade at partial_at x risk, move the stop to break-even,
                     let the rest run to rr x risk
Costs: one spread per trade (dashboard spreads), counted in R.
"""
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "cinco-apa"))
from backtest import pivots, exit_on_bar  # noqa: E402  (same helpers as the earlier tests)

FIFTEEN_MINUTES = pd.Timedelta(minutes=15)


# ---------- 15m setups ----------

def setups_15m(df15, swing=5):
    """Every hidden-invalidation signal on the 15m chart, with the time it becomes known (candle close)."""
    o, h, l, c = (df15[k].to_numpy() for k in "ohlc")
    ph, pl = pivots(h, l, swing)
    last_high = last_low = bull_inv = bear_inv = math.nan
    bull_active = bear_active = False
    found = []
    for i in range(1, len(c)):
        # structure: newest confirmed swing high / low (known swing candles late, like ta.pivothigh)
        if not math.isnan(ph[i]): last_high = ph[i]
        if not math.isnan(pl[i]): last_low = pl[i]
        bull_break = not math.isnan(last_high) and c[i] > last_high and c[i - 1] <= last_high
        bear_break = not math.isnan(last_low) and c[i] < last_low and c[i - 1] >= last_low
        if bull_break and not math.isnan(last_low):
            bull_inv, bull_active, bear_active = last_low, True, False
        if bear_break and not math.isnan(last_high):
            bear_inv, bear_active, bull_active = last_high, True, False
        # the sweep: wick through the invalidation level, close back inside
        if bull_active and l[i] < bull_inv and c[i] > bull_inv:
            found.append(dict(known_at=df15.index[i] + FIFTEEN_MINUTES, side=1, high=h[i], low=l[i]))
            bull_active = False
        elif bear_active and h[i] > bear_inv and c[i] < bear_inv:
            found.append(dict(known_at=df15.index[i] + FIFTEEN_MINUTES, side=-1, high=h[i], low=l[i]))
            bear_active = False
        if bull_active and c[i] < bull_inv: bull_active = False
        if bear_active and c[i] > bear_inv: bear_active = False
    return found


# ---------- 5m helpers ----------

def atr(h, l, c, length=14):
    previous = np.roll(c, 1)
    true_range = np.maximum(h - l, np.maximum(abs(h - previous), abs(l - previous)))
    return pd.Series(true_range).rolling(length).mean().to_numpy()


def daily_ema_on(df5, span):
    """Yesterday's daily EMA for every 5m candle (no look-ahead)."""
    daily = df5.c.resample("1D").last().dropna().ewm(span=span, adjust=False).mean().shift(1)
    return daily.reindex(df5.index.floor("1D")).to_numpy()


def is_confirmed(kind, side, o, c, i, pending, swing_high, swing_low):
    """Does 5m candle i confirm the pending 15m setup?"""
    in_colour = c[i] > o[i] if side > 0 else c[i] < o[i]
    if not in_colour:
        return False
    if kind == "break":
        return c[i] > pending["high"] if side > 0 else c[i] < pending["low"]
    if kind == "choch":
        level = swing_high if side > 0 else swing_low
        return not math.isnan(level) and (c[i] > level if side > 0 else c[i] < level)
    if kind == "engulf":
        top, bottom = max(o[i - 1], c[i - 1]), min(o[i - 1], c[i - 1])
        return c[i] >= top and o[i] <= bottom if side > 0 else c[i] <= bottom and o[i] >= top
    raise ValueError(kind)


# ---------- the 5m trade loop ----------

def run(df5, setups, confirm="break", window15=3, rr=1.5, stop_atr=0.0, daily_ema=0, hours=None,
        spread=0.0, mintick=1e-6, swing5=3, be_at=0.0, partial_at=0.0, partial_size=0.5):
    """Trades taken on the 5m chart from the 15m setups. Returns one row per closed trade."""
    o, h, l, c = (df5[k].to_numpy() for k in "ohlc")
    times = df5.index
    ph5, pl5 = pivots(h, l, swing5)
    atr5 = atr(h, l, c)
    trend = daily_ema_on(df5, daily_ema) if daily_ema else None
    hour = times.hour.to_numpy()
    swing_high = swing_low = math.nan
    next_setup = 0
    pending = None
    position = 0
    trades = []

    for i in range(1, len(c)):
        # 1) manage the open trade (stop/target live from the candle after entry)
        if position != 0:
            price, why = exit_on_bar(position, o[i], h[i], l[i], c[i], stop, target)
            moved_R = (price - entry) * position / risk if price is not None else 0.0
            if price is not None and why == "target" and partial_at and not partial_done:
                # first target: bank part of the trade, protect the rest at break-even (from the next candle)
                banked_R, partial_done = partial_size * moved_R, True
                stop, target = entry + position * spread, entry + position * rr * risk
            elif price is not None:
                gross = banked_R + (1 - partial_size if partial_done else 1.0) * moved_R
                trades.append((entry_time, times[i], position, entry, price, risk, why, gross))
                position = 0
            elif be_at and not at_break_even:
                best = h[i] if position > 0 else l[i]
                if (best - entry) * position >= be_at * risk:
                    stop, at_break_even = entry + position * spread, True

        # 2) 15m setups whose candle has closed by the start of this 5m candle
        while next_setup < len(setups) and setups[next_setup]["known_at"] <= times[i]:
            setup = setups[next_setup]
            next_setup += 1
            if position == 0 and pending is None:
                pending = dict(setup, extreme=setup["low"] if setup["side"] > 0 else setup["high"],
                               expires=setup["known_at"] + window15 * FIFTEEN_MINUTES)

        # 3) work the pending setup with this 5m candle
        if pending is not None and position == 0:
            side = pending["side"]
            if times[i] >= pending["expires"]:
                pending = None
            else:
                pending["extreme"] = min(pending["extreme"], l[i]) if side > 0 else max(pending["extreme"], h[i])
                cancelled = c[i] < pending["low"] if side > 0 else c[i] > pending["high"]
                if cancelled:
                    pending = None
                elif is_confirmed(confirm, side, o, c, i, pending, swing_high, swing_low):
                    allowed = passes_filters(side, c[i], i, trend, hour, hours)
                    new_stop = pending["extreme"]
                    if stop_atr and not math.isnan(atr5[i]):
                        new_stop -= side * stop_atr * atr5[i]
                    new_risk = (c[i] - new_stop) * side
                    if allowed and new_risk > mintick:
                        position, entry, stop, risk, entry_time = side, c[i], new_stop, new_risk, times[i]
                        first_target = partial_at if partial_at else rr
                        target = entry + side * first_target * risk
                        banked_R, partial_done, at_break_even = 0.0, False, False
                    pending = None

        # 4) newest confirmed 5m swing (used by the NEXT candles' choch check)
        if not math.isnan(ph5[i]): swing_high = ph5[i]
        if not math.isnan(pl5[i]): swing_low = pl5[i]

    frame = pd.DataFrame(trades, columns=["entry_time", "exit_time", "side", "entry", "exit", "risk", "why", "gross_R"])
    frame["net_R"] = frame.gross_R - spread / frame.risk
    frame["stop_in_spreads"] = frame.risk / spread if spread else np.nan
    return frame


def passes_filters(side, close, i, trend, hour, hours):
    if trend is not None and not (not math.isnan(trend[i]) and (close - trend[i]) * side > 0):
        return False
    if hours is not None and hour[i] not in hours:
        return False
    return True
