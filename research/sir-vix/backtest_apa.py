"""Backtests the group admin's APA ("Advanced Price Action") recipe on a year of Deriv 5-minute candles.

The recipe as he posted it (10 Aug 2026):
  1. Go to the 1H, find a re-balance (fair value gap); sell from premium, buy from discount.
  2. On the 15M/30M the re-balance is an order block being mitigated (price trades back into it).
  3. On the 5M use the last unmitigated order block for entry ("enter on confirmation").
  Direction comes from the higher timeframes (he reads 24H/4H/1H). SL at the order block's high/low.
  Targets he quotes: 1:2 most often, sometimes 1:5 or "TP open".

How each step is made mechanical here (no look-ahead: higher-timeframe bars count only once closed,
swing points count only once the bars that confirm them have closed):
  bias        4H market structure: bullish after a 4H close above the last confirmed swing high,
              bearish after a close below the last confirmed swing low (fractal, 2 bars each side).
  re-balance  1H fair value gap in the bias direction, in premium (bearish gap above the middle of the
              last 48 hours' range) or discount (bullish gap below it); dropped once a 1H close goes
              through its far edge or after 5 days.
  mitigation  a 5M candle trades into the gap without closing through it: setup armed.
  confirmation  within 4 hours, a 5M close breaks the last confirmed 5M swing low (sells) or high (buys).
  entry       the last opposite-colour 5M candle before that break is the order block. Limit order at its
              body edge, stop at its far wick. Order cancelled if not filled within 3 hours or if price
              reaches the target first.
  exit        stop, the R-multiple target, or the close after 24 hours, whichever comes first.

Setups are found on 5M bars built from 1M candles; orders are filled and closed on the 1M candles, so
tight order-block stops are not blurred by 5M bar ranges. In the minute the order fills, a touch of the
stop counts (price had to pass the entry first to get there) but a touch of the target does not. If the
stop and target are both inside one later minute, the stop is counted (worst case).
"""
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
SYMBOLS = ["R_10", "R_25", "R_75", "R_100", "1HZ10V", "1HZ15V", "1HZ25V", "1HZ30V", "1HZ75V", "1HZ90V", "1HZ100V"]
TARGET_MULTIPLES = [1, 2, 3, 5]
SWING_WING = 2
RANGE_HOURS = 48
GAP_LIFETIME = pd.Timedelta(days=5)
ARMED_BARS = 48
PENDING_MINUTES = 180
HOLD_MINUTES = 1440


def load_minutes(symbol):
    frame = pd.read_csv(HERE / "data" / f"{symbol}_60.csv")
    frame.index = pd.to_datetime(frame.pop("time"), unit="s")
    return frame


def resample(frame, rule):
    bars = frame.resample(rule, label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    bars["closes_at"] = bars.index + pd.Timedelta(rule)
    return bars


def confirmed_swings(highs, lows, wing=SWING_WING):
    """Yields (confirmed_at_index, kind, level) for fractal swing points."""
    for pivot in range(wing, len(highs) - wing):
        window = slice(pivot - wing, pivot + wing + 1)
        if highs[pivot] == highs[window].max():
            yield pivot + wing, "high", highs[pivot]
        if lows[pivot] == lows[window].min():
            yield pivot + wing, "low", lows[pivot]


def four_hour_bias(four_hour):
    """Series indexed by the time the bias becomes known: +1 bullish, -1 bearish."""
    highs, lows, closes = four_hour.high.values, four_hour.low.values, four_hour.close.values
    swings_by_index = {}
    for confirmed_at, kind, level in confirmed_swings(highs, lows):
        swings_by_index.setdefault(confirmed_at, []).append((kind, level))
    last_high = last_low = math.nan
    bias, values = 0, []
    for index in range(len(closes)):
        for kind, level in swings_by_index.get(index, []):
            if kind == "high":
                last_high = level
            else:
                last_low = level
        if closes[index] > last_high:
            bias = 1
        elif closes[index] < last_low:
            bias = -1
        values.append(bias)
    return pd.Series(values, index=four_hour.closes_at.values)


@dataclass
class Gap:
    side: int
    bottom: float
    top: float
    known_at: pd.Timestamp


def one_hour_gaps(one_hour):
    """Fair value gaps in premium (bearish) or discount (bullish), with the time each becomes known."""
    highs, lows = one_hour.high.values, one_hour.low.values
    range_high = one_hour.high.rolling(RANGE_HOURS).max().values
    range_low = one_hour.low.rolling(RANGE_HOURS).min().values
    gaps = []
    for index in range(2, len(one_hour)):
        middle = (range_high[index] + range_low[index]) / 2
        known_at = one_hour.closes_at.iloc[index]
        if highs[index] < lows[index - 2] and highs[index] >= middle:
            gaps.append(Gap(-1, highs[index], lows[index - 2], known_at))
        if lows[index] > highs[index - 2] and lows[index] <= middle:
            gaps.append(Gap(1, highs[index - 2], lows[index], known_at))
    return gaps


def gap_closures(one_hour, gaps):
    """Time each gap stops being usable: a 1H close through its far edge, or its lifetime running out."""
    closes, closes_at = one_hour.close.values, one_hour.closes_at.values
    closures = []
    for gap in gaps:
        start = np.searchsorted(closes_at, np.datetime64(gap.known_at), side="right")
        broken = closes[start:] > gap.top if gap.side == -1 else closes[start:] < gap.bottom
        expiry = gap.known_at + GAP_LIFETIME
        broken_at = pd.Timestamp(closes_at[start + broken.argmax()]) if broken.any() else expiry
        closures.append(min(broken_at, expiry))
    return closures


@dataclass
class Trade:
    symbol: str
    side: int
    filled_at: pd.Timestamp
    entry: float
    stop: float
    result_r: float


class MinuteBook:
    """Fills and closes one order at a time on 1M candles."""

    def __init__(self, minutes):
        self.times = minutes.index.values
        self.highs = minutes.high.values
        self.lows = minutes.low.values
        self.closes = minutes.close.values

    def first(self, mask):
        return int(mask.argmax()) if mask.any() else None

    def execute(self, order, placed_at, target_multiple):
        """Returns (exit_time, result_r or None when the order never filled)."""
        side, entry, stop, risk = order["side"], order["entry"], order["stop"], order["risk"]
        target = entry + side * target_multiple * risk
        start = int(np.searchsorted(self.times, np.datetime64(placed_at)))
        waiting = slice(start, start + PENDING_MINUTES)
        highs, lows = self.highs[waiting], self.lows[waiting]
        fill = self.first(highs >= entry if side == -1 else lows <= entry)
        ran_away = self.first(lows <= target if side == -1 else highs >= target)
        if fill is None or (ran_away is not None and ran_away <= fill):
            last = min(start + PENDING_MINUTES, len(self.times)) - 1
            return pd.Timestamp(self.times[last]), None
        filled = start + fill
        held = slice(filled, filled + HOLD_MINUTES)
        highs, lows = self.highs[held], self.lows[held]
        stop_mask = highs >= stop if side == -1 else lows <= stop
        target_mask = lows <= target if side == -1 else highs >= target
        target_mask[0] = False
        stop_at, target_at = self.first(stop_mask), self.first(target_mask)
        if stop_at is not None and (target_at is None or stop_at <= target_at):
            return pd.Timestamp(self.times[filled + stop_at]), -1.0
        if target_at is not None:
            return pd.Timestamp(self.times[filled + target_at]), float(target_multiple)
        last = filled + len(highs) - 1
        return pd.Timestamp(self.times[last]), (self.closes[last] - entry) * side / risk


class Simulator:
    """Walks the 5M bars once for one target multiple and records every trade."""

    def __init__(self, symbol, five_minute, minutes, bias, gaps, closures, target_multiple):
        self.symbol = symbol
        self.bars = five_minute
        self.book = MinuteBook(minutes)
        self.bias_at = bias.reindex(five_minute.index + pd.Timedelta(minutes=5), method="ffill").fillna(0).values
        self.gaps = gaps
        self.gap_known = np.array([np.datetime64(gap.known_at) for gap in gaps])
        self.gap_closed = np.array([np.datetime64(closed) for closed in closures])
        self.target_multiple = target_multiple
        self.trades = []

    def active_gaps(self, time, side):
        moment = np.datetime64(time)
        live = (self.gap_known <= moment) & (self.gap_closed > moment)
        return [self.gaps[i] for i in np.flatnonzero(live) if self.gaps[i].side == side]

    def run(self):
        times = self.bars.index
        opens, highs, lows, closes = (self.bars[c].values for c in ("open", "high", "low", "close"))
        swing_events = {}
        for confirmed_at, kind, level in confirmed_swings(highs, lows):
            swing_events.setdefault(confirmed_at, []).append((kind, level))
        last_swing = {"high": math.nan, "low": math.nan}
        setup, resume_at = {}, times[0]
        for i in range(len(times)):
            for kind, level in swing_events.get(i, []):
                last_swing[kind] = level
            if times[i] < resume_at:
                continue
            if not setup:
                setup = self.try_arm(i, times[i], highs[i], lows[i], closes[i])
                continue
            setup, order = self.try_confirm(i, setup, opens, highs, lows, closes, last_swing)
            if order:
                resume_at = self.place(order, times[i] + pd.Timedelta(minutes=5))
        return self.trades

    def place(self, order, placed_at):
        exit_time, result_r = self.book.execute(order, placed_at, self.target_multiple)
        if result_r is not None:
            self.trades.append(Trade(self.symbol, order["side"], placed_at, order["entry"], order["stop"], result_r))
        return exit_time

    def try_arm(self, i, time, high, low, close):
        side = int(self.bias_at[i])
        if side == 0:
            return {}
        for gap in self.active_gaps(time, side):
            touched = high >= gap.bottom if side == -1 else low <= gap.top
            held = close <= gap.top if side == -1 else close >= gap.bottom
            if touched and held:
                return {"side": side, "gap": gap, "armed_index": i}
        return {}

    def try_confirm(self, i, setup, opens, highs, lows, closes, last_swing):
        """Returns (setup still armed or {}, order or None)."""
        side, gap = setup["side"], setup["gap"]
        expired = i - setup["armed_index"] > ARMED_BARS
        gap_broken = (side == -1 and closes[i] > gap.top) or (side == 1 and closes[i] < gap.bottom)
        if expired or gap_broken:
            return {}, None
        broke = closes[i] < last_swing["low"] if side == -1 else closes[i] > last_swing["high"]
        if not broke:
            return setup, None
        block = self.order_block(setup["armed_index"], i, side, opens, closes)
        if block is None:
            return {}, None
        entry = opens[block]
        stop = highs[block] if side == -1 else lows[block]
        risk = (stop - entry) * -side
        return {}, ({"side": side, "entry": entry, "stop": stop, "risk": risk} if risk > 0 else None)

    @staticmethod
    def order_block(start, end, side, opens, closes):
        """Last up-candle (for sells) or down-candle (for buys) between arming and the break."""
        for index in range(end - 1, start - 1, -1):
            up_candle = closes[index] > opens[index]
            down_candle = closes[index] < opens[index]
            if (side == -1 and up_candle) or (side == 1 and down_candle):
                return index
        return None


def summarise(trades):
    results = np.array([trade.result_r for trade in trades])
    if len(results) == 0:
        return {"trades": 0}
    deviation = results.std(ddof=1) if len(results) > 1 else math.nan
    return {
        "trades": len(results),
        "win_rate": round(float((results > 0).mean()), 3),
        "net_R": round(float(results.sum()), 1),
        "avg_R": round(float(results.mean()), 3),
        "t_stat": round(float(results.mean() / (deviation / math.sqrt(len(results)))), 2) if deviation else None,
    }


def run_symbol(symbol, target_multiple):
    return run_frame(symbol, load_minutes(symbol), target_multiple)


def run_frame(symbol, minutes, target_multiple):
    five_minute = resample(minutes, "5min").drop(columns="closes_at")
    bias = four_hour_bias(resample(minutes, "4h"))
    one_hour = resample(minutes, "1h")
    gaps = one_hour_gaps(one_hour)
    closures = gap_closures(one_hour, gaps)
    return Simulator(symbol, five_minute, minutes, bias, gaps, closures, target_multiple).run()


def main():
    symbols = sys.argv[1:] or SYMBOLS
    report = {}
    all_trades = []
    for multiple in TARGET_MULTIPLES:
        per_symbol = {}
        pooled = []
        for symbol in symbols:
            trades = run_symbol(symbol, multiple)
            per_symbol[symbol] = summarise(trades)
            pooled += trades
        report[f"{multiple}R"] = {"breakeven_win_rate": round(1 / (1 + multiple), 3),
                                  "all_symbols": summarise(pooled), "by_symbol": per_symbol}
        all_trades += [{**trade.__dict__, "target_R": multiple, "filled_at": str(trade.filled_at)} for trade in pooled]
        print(f"{multiple}R", json.dumps(report[f"{multiple}R"]["all_symbols"]), flush=True)
    (HERE / "output").mkdir(exist_ok=True)
    (HERE / "output" / "apa_backtest.json").write_text(json.dumps(report, indent=2))
    pd.DataFrame(all_trades).to_csv(HERE / "output" / "apa_trades.csv", index=False)


if __name__ == "__main__":
    main()
