"""Entry rules for the search. Every rule decides on a CLOSED candle, using only that candle and older ones.

A signal array holds +1 (buy), -1 (sell) or 0 (nothing) for each candle. The trade itself is filled at the
open of the NEXT candle by engine.py, so no rule can see the price it trades at.
"""
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd

TIMEFRAME_MINUTES = (15, 30, 60, 240)
STOP_ATR_MULTIPLES = (1.0, 2.0, 3.0)
# A number is a reward:risk target. None means no target: hold until the opposite signal.
EXIT_TARGETS = (1.0, 2.0, 3.0, None)
VOLATILITY_FILTERS = ("any", "high", "low")
ATR_PERIOD = 14
VOLATILITY_LOOKBACK = 200


@dataclass(frozen=True)
class Setting:
    """One complete strategy: an entry rule on a timeframe, with its stop, exit and volatility filter."""
    rule: str
    parameters: tuple
    minutes: int
    stop_atr: float
    reward_risk: Optional[float]
    volatility: str

    def label(self):
        """A short readable name, used in the result tables."""
        exit_name = "opposite signal" if self.reward_risk is None else f"RR {self.reward_risk:g}"
        parameters = ",".join(str(value) for value in self.parameters)
        return f"{self.rule}({parameters}) {self.minutes}m stop {self.stop_atr:g} ATR {exit_name} vol {self.volatility}"


def build_bars(candles, minutes):
    """Builds larger candles from 5-minute candles, and notes which 5-minute candle starts each one."""
    aggregations = {"open": "first", "high": "max", "low": "min", "close": "last"}
    bars = candles.resample(f"{minutes}min", label="left", closed="left").agg(aggregations).dropna()
    # The last bar may still be incomplete, so it is removed unless all of its candles exist.
    last_bar_end = bars.index[-1] + pd.Timedelta(minutes=minutes)
    if last_bar_end > candles.index[-1] + pd.Timedelta(minutes=5):
        bars = bars.iloc[:-1]
    bars["first_candle"] = np.searchsorted(candles.index.values, bars.index.values)
    return bars


def average_true_range(bars, period=ATR_PERIOD):
    """Wilder's Average True Range: how far price typically moves in one candle."""
    previous_close = bars.close.shift(1)
    true_range = pd.concat([bars.high - bars.low, (bars.high - previous_close).abs(),
                            (bars.low - previous_close).abs()], axis=1).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def relative_strength_index(close, period):
    """Wilder's RSI: 0 to 100, how much of the recent movement was upward."""
    change = close.diff()
    gains = change.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    losses = (-change.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    return 100 - 100 / (1 + gains / losses.replace(0, np.nan))


def crossed_above(series, level):
    """True on the candle where the series moves from at-or-below the level to above it."""
    return (series > level) & (series.shift(1) <= level.shift(1))


def signals_from(buy, sell):
    """Turns buy and sell conditions into one +1 / -1 / 0 array; a candle with both does nothing."""
    return buy.fillna(False).to_numpy().astype(np.int8) - sell.fillna(False).to_numpy().astype(np.int8)


def ema_cross(bars, fast, slow):
    """Trend following: buy when the fast average crosses above the slow one, sell on the reverse."""
    fast_line = bars.close.ewm(span=fast, adjust=False, min_periods=slow).mean()
    slow_line = bars.close.ewm(span=slow, adjust=False, min_periods=slow).mean()
    return signals_from(crossed_above(fast_line, slow_line), crossed_above(slow_line, fast_line))


def channel_breakout(bars, length):
    """Breakout: buy on a close above the highest high of the previous candles, sell on the reverse."""
    upper = bars.high.rolling(length).max().shift(1)
    lower = bars.low.rolling(length).min().shift(1)
    return signals_from(crossed_above(bars.close, upper), crossed_above(lower, bars.close))


def momentum(bars, length, threshold):
    """Momentum: buy when the move over the lookback becomes unusually strong for this market's volatility."""
    strength = (bars.close - bars.close.shift(length)) / (average_true_range(bars) * np.sqrt(length))
    up_level = pd.Series(threshold, index=bars.index)
    return signals_from(crossed_above(strength, up_level), crossed_above(-up_level, strength))


def rsi_reversion(bars, period, low, high):
    """Mean reversion: buy when RSI climbs back out of oversold, sell when it falls back out of overbought."""
    rsi = relative_strength_index(bars.close, period)
    low_level = pd.Series(low, index=bars.index)
    high_level = pd.Series(high, index=bars.index)
    return signals_from(crossed_above(rsi, low_level), crossed_above(high_level, rsi))


def bollinger_bands(bars, length, width):
    """The moving average of the close, plus and minus a number of standard deviations."""
    middle = bars.close.rolling(length).mean()
    spread = bars.close.rolling(length).std()
    return middle - width * spread, middle + width * spread


def bollinger_reversion(bars, length, width):
    """Mean reversion: buy when price closes back inside the lower band, sell back inside the upper band."""
    lower, upper = bollinger_bands(bars, length, width)
    return signals_from(crossed_above(bars.close, lower), crossed_above(upper, bars.close))


def bollinger_breakout(bars, length, width):
    """Breakout: buy on a close through the upper band, sell on a close through the lower band."""
    lower, upper = bollinger_bands(bars, length, width)
    return signals_from(crossed_above(bars.close, upper), crossed_above(lower, bars.close))


def confirmed_swing_level(values, size):
    """The latest swing point, which only becomes known `size` candles after it formed."""
    window = 2 * size + 1
    is_swing = values.shift(size) == values.rolling(window).max()
    return values.shift(size).where(is_swing).ffill()


def swing_break(bars, size):
    """Market structure: buy on a close above the last confirmed swing high, sell below the last swing low."""
    swing_high = confirmed_swing_level(bars.high, size)
    swing_low = -confirmed_swing_level(-bars.low, size)
    return signals_from(crossed_above(bars.close, swing_high), crossed_above(swing_low, bars.close))


def inside_bar_break(bars):
    """Price action: after a candle sits inside the one before it, trade the close through that larger candle."""
    mother_high, mother_low = bars.high.shift(2), bars.low.shift(2)
    was_inside = (bars.high.shift(1) < mother_high) & (bars.low.shift(1) > mother_low)
    return signals_from(was_inside & (bars.close > mother_high), was_inside & (bars.close < mother_low))


def engulfing(bars):
    """Price action: a candle whose body swallows the previous opposite-coloured body."""
    previous_open, previous_close = bars.open.shift(1), bars.close.shift(1)
    buy = (bars.close > bars.open) & (previous_close < previous_open)
    buy &= (bars.close >= previous_open) & (bars.open <= previous_close)
    sell = (bars.close < bars.open) & (previous_close > previous_open)
    sell &= (bars.close <= previous_open) & (bars.open >= previous_close)
    return signals_from(buy, sell)


def rejection_candle(bars):
    """Price action: a long wick against the move, at least twice the body and 60% of the candle."""
    body = (bars.close - bars.open).abs()
    candle_range = bars.high - bars.low
    lower_wick = bars[["open", "close"]].min(axis=1) - bars.low
    upper_wick = bars.high - bars[["open", "close"]].max(axis=1)
    buy = (lower_wick >= 2 * body) & (lower_wick >= 0.6 * candle_range) & (candle_range > 0)
    sell = (upper_wick >= 2 * body) & (upper_wick >= 0.6 * candle_range) & (candle_range > 0)
    return signals_from(buy, sell)


RULE_FUNCTIONS = {"ema_cross": ema_cross, "channel_breakout": channel_breakout, "momentum": momentum,
                  "rsi_reversion": rsi_reversion, "bollinger_reversion": bollinger_reversion,
                  "bollinger_breakout": bollinger_breakout, "swing_break": swing_break,
                  "inside_bar_break": inside_bar_break, "engulfing": engulfing, "rejection_candle": rejection_candle}

RULE_VARIATIONS = (("ema_cross", (9, 21)), ("ema_cross", (20, 50)), ("ema_cross", (50, 200)),
                   ("channel_breakout", (20,)), ("channel_breakout", (55,)), ("channel_breakout", (100,)),
                   ("momentum", (10, 1.0)), ("momentum", (20, 1.5)), ("momentum", (50, 2.0)),
                   ("rsi_reversion", (14, 30, 70)), ("rsi_reversion", (14, 20, 80)), ("rsi_reversion", (2, 10, 90)),
                   ("bollinger_reversion", (20, 2.0)), ("bollinger_reversion", (20, 2.5)),
                   ("bollinger_breakout", (20, 2.0)), ("bollinger_breakout", (50, 2.0)),
                   ("swing_break", (3,)), ("swing_break", (5,)), ("swing_break", (10,)),
                   ("inside_bar_break", ()), ("engulfing", ()), ("rejection_candle", ()))


def every_setting():
    """Lists every combination the search will test, fixed before any result is seen."""
    return [Setting(rule, parameters, minutes, stop, target, volatility)
            for rule, parameters in RULE_VARIATIONS for minutes in TIMEFRAME_MINUTES
            for stop in STOP_ATR_MULTIPLES for target in EXIT_TARGETS for volatility in VOLATILITY_FILTERS]


def volatility_mask(bars, atr, choice):
    """True where the candle meets the filter: volatility above or below its own recent median."""
    if choice == "any":
        return np.ones(len(bars), dtype=bool)
    relative_atr = atr / bars.close
    median = relative_atr.rolling(VOLATILITY_LOOKBACK, min_periods=VOLATILITY_LOOKBACK // 4).median()
    return ((relative_atr > median) if choice == "high" else (relative_atr < median)).to_numpy()


def signals_for(bars, atr, rule, parameters, volatility):
    """The final signals of one rule after applying its volatility filter."""
    raw_signals = RULE_FUNCTIONS[rule](bars, *parameters)
    return raw_signals * volatility_mask(bars, atr, volatility)
