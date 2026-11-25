"""Plays out trades on 5-minute candles and measures the results in R (multiples of the amount risked).

Assumptions, all chosen to avoid flattering a strategy:
  * The fill is the open of the candle AFTER the signal candle.
  * If stop and target are both touched within one 5-minute candle, the stop counts.
  * A candle that opens past the stop fills at that worse open.
  * Spread and slippage are charged on every trade.
"""
from dataclasses import dataclass

import numpy as np

MAX_HOLD_BARS = 200
FIRST_SEARCH_CHUNK = 64


@dataclass
class CandleArrays:
    """5-minute prices as plain arrays. 'worst' and 'best' are the extremes seen from each side of a trade."""
    open: np.ndarray
    worst_long: np.ndarray
    worst_short: np.ndarray
    negative_best_long: np.ndarray
    negative_best_short: np.ndarray

    @classmethod
    def from_candles(cls, candles):
        """Stores lows and highs so buys and sells can share one search routine."""
        high, low = candles.high.to_numpy(), candles.low.to_numpy()
        return cls(candles.open.to_numpy(), low, -high, -high, low)

    def worst_for(self, side):
        """The price series that a stop is checked against."""
        return self.worst_long if side > 0 else self.worst_short

    def negative_best_for(self, side):
        """The price series that a target is checked against."""
        return self.negative_best_long if side > 0 else self.negative_best_short


@dataclass
class Trades:
    """One strategy's trades, oldest first."""
    entry: np.ndarray
    exit: np.ndarray
    side: np.ndarray
    net_r: np.ndarray
    cost_r: np.ndarray

    def select(self, mask):
        """Returns only the trades where the mask is true."""
        return Trades(self.entry[mask], self.exit[mask], self.side[mask], self.net_r[mask], self.cost_r[mask])

    def __len__(self):
        return len(self.net_r)


def first_at_or_below(values, level, start, end):
    """Finds the first position from start to end where values <= level; returns end if there is none."""
    chunk = FIRST_SEARCH_CHUNK
    while start < end:
        chunk_end = min(start + chunk, end)
        hits = values[start:chunk_end] <= level
        first = int(hits.argmax())
        if hits[first]:
            return start + first
        start = chunk_end
        # Most trades finish quickly, so search small windows first and widen only when needed.
        chunk *= 2
    return end


def next_opposite_bar(signals, bar, side, opposite_bars):
    """The first bar after this one with a signal against the trade, or -1 when there is none."""
    candidates = opposite_bars[side]
    position = np.searchsorted(candidates, bar, side="right")
    return int(candidates[position]) if position < len(candidates) else -1


def forced_exit_candle(first_candle, signal_bar, opposite_bar, last_candle):
    """The candle at which the trade ends if neither stop nor target is reached."""
    time_limit_bar = signal_bar + 1 + MAX_HOLD_BARS
    limit = int(first_candle[time_limit_bar]) if time_limit_bar < len(first_candle) else last_candle
    if 0 <= opposite_bar < len(first_candle) - 1:
        limit = min(limit, int(first_candle[opposite_bar + 1]))
    return limit


def play_trade(candles, side, entry_candle, forced_exit, risk, reward_risk):
    """Walks one trade forward; returns the exit candle and the move in the trade's favour, before costs."""
    entry_price = candles.open[entry_candle]
    # In these coordinates a higher number is always better for the trade, for buys and sells alike.
    entry_level = side * entry_price
    stop_level = entry_level - risk
    stop_candle = first_at_or_below(candles.worst_for(side), stop_level, entry_candle, forced_exit)
    if reward_risk is not None:
        target_level = entry_level + reward_risk * risk
        # The target only counts if it comes strictly before the stop, so ties go to the stop.
        target_candle = first_at_or_below(candles.negative_best_for(side), -target_level, entry_candle, stop_candle)
        if target_candle < stop_candle:
            return target_candle, reward_risk * risk
    if stop_candle < forced_exit:
        worst_fill = min(stop_level, side * candles.open[stop_candle])
        return stop_candle, worst_fill - entry_level
    return forced_exit, side * candles.open[forced_exit] - entry_level


def simulate(candles, first_candle, signals, atr, stop_atr, reward_risk, cost):
    """Runs one strategy through history, holding at most one trade at a time."""
    last_candle = len(candles.open) - 1
    signal_bars = np.flatnonzero(signals[:-1])
    opposite_bars = {1: np.flatnonzero(signals == -1), -1: np.flatnonzero(signals == 1)}
    entries, exits, sides, net_results, costs = [], [], [], [], []
    next_free_candle = 0
    for bar in signal_bars:
        entry_candle = int(first_candle[bar + 1])
        risk = stop_atr * atr[bar]
        # Skip signals that arrive while a trade is open or before the ATR exists.
        if entry_candle < next_free_candle or not risk > 0:
            continue
        side = int(signals[bar])
        opposite_bar = next_opposite_bar(signals, bar, side, opposite_bars) if reward_risk is None else -1
        forced_exit = forced_exit_candle(first_candle, bar, opposite_bar, last_candle)
        exit_candle, move = play_trade(candles, side, entry_candle, forced_exit, risk, reward_risk)
        entries.append(entry_candle)
        exits.append(exit_candle)
        sides.append(side)
        cost_r = cost / risk
        net_results.append(move / risk - cost_r)
        costs.append(cost_r)
        next_free_candle = exit_candle + 1
    return Trades(np.array(entries, dtype=np.int64), np.array(exits, dtype=np.int64), np.array(sides, dtype=np.int8),
                  np.array(net_results, dtype=float), np.array(costs, dtype=float))
