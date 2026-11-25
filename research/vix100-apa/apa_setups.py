"""APA setups on any timeframe. Each setup is only "known" once its candle has closed.

Three APA models, all using the same confirmed swings (5 candles each side):
  sweep    Hidden invalidation: after a break of structure, a candle wicks through the invalidation level
           and closes back inside. Reuses the 15m code from research/apa-15m-5m-confirm.
  sbr_rbs  Support-becomes-resistance / resistance-becomes-support: the swing that was just broken is retested
           and a candle rejects it.
  qm       Quasimodo: a change of character (a break against the current trend), then a rejection of the
           left shoulder, which is the swing before the latest one.

Simplification: levels use the swing's wick, not its candle body as the dashboard's QM zone does.
"""
import math
import sys
from pathlib import Path

import pandas as pd

RESEARCH = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RESEARCH / "apa-15m-5m-confirm"))
sys.path.insert(0, str(RESEARCH / "cinco-apa"))
from backtest import pivots  # noqa: E402  (same swing finder as every earlier test)
from backtest_mtf import setups_15m  # noqa: E402

FIFTEEN_MINUTES = pd.Timedelta(minutes=15)
SWING_CANDLES = 5
# A retest level stops being watched this many candles after the break that created it.
LEVEL_LIFETIME_CANDLES = 48


def find_setups(candles, model, candle_length):
    """Returns the model's setups in time order, each with known_at, side, high and low."""
    if model == "sweep":
        return sweep_setups(candles, candle_length)
    return retest_setups(candles, model, candle_length)


def sweep_setups(candles, candle_length):
    """Runs the existing sweep finder, then corrects its 15m close time to this timeframe's close time."""
    found = setups_15m(candles, swing=SWING_CANDLES)
    # The older finder always adds 15 minutes, so swap that for the real candle length.
    return [dict(setup, known_at=setup["known_at"] - FIFTEEN_MINUTES + candle_length) for setup in found]


def chosen_level(model, side, trend, swings):
    """Picks the price to watch after a break, or NaN if this break gives the model nothing."""
    # side is +1 for an upward break and -1 for a downward break.
    broken_swing = swings["high"] if side > 0 else swings["low"]
    if model == "sbr_rbs":
        return broken_swing
    if model == "qm":
        # A quasimodo needs a break AGAINST the trend, so a break with the trend gives no level.
        if trend != -side:
            return math.nan
        return swings["previous_low"] if side > 0 else swings["previous_high"]
    raise ValueError(f"Unknown model: {model}")


def record_new_swings(swings, swing_high, swing_low):
    """Stores any newly confirmed swing and keeps the one before it (the left shoulder)."""
    if not math.isnan(swing_high):
        swings["previous_high"], swings["high"] = swings["high"], swing_high
    if not math.isnan(swing_low):
        swings["previous_low"], swings["low"] = swings["low"], swing_low


def broke_level(level, close, previous_close, side):
    """True when this candle is the one that closes through the level in the direction of side."""
    if math.isnan(level):
        return False
    return close > level and previous_close <= level if side > 0 else close < level and previous_close >= level


def is_rejection(level, high, low, close, side):
    """True when the candle touches the level and closes back on the trade's side of it."""
    return low <= level < close if side > 0 else close < level <= high


def is_broken_through(level, close, side):
    """True when a close on the wrong side of the level means the level has failed."""
    return close < level if side > 0 else close > level


def retest_setups(candles, model, candle_length):
    """Finds rejections of levels created by breaks of structure, for the sbr_rbs and qm models."""
    highs, lows, closes = (candles[column].to_numpy() for column in "hlc")
    swing_highs, swing_lows = pivots(highs, lows, SWING_CANDLES)
    swings = dict(high=math.nan, low=math.nan, previous_high=math.nan, previous_low=math.nan)
    trend, watched, found = 0, None, []

    for index in range(1, len(closes)):
        # First learn any swing confirmed by this candle, exactly as the live chart would.
        record_new_swings(swings, swing_highs[index], swing_lows[index])

        # Next, check whether the level already being watched was rejected, failed or got too old.
        if watched is not None:
            side, level = watched["side"], watched["level"]
            if is_rejection(level, highs[index], lows[index], closes[index], side):
                found.append(dict(known_at=candles.index[index] + candle_length, side=side,
                                  high=highs[index], low=lows[index]))
                watched = None
            elif is_broken_through(level, closes[index], side) or index - watched["born"] > LEVEL_LIFETIME_CANDLES:
                watched = None

        # Finally, a new break of structure replaces whatever level was being watched.
        for side, broken_swing in ((1, swings["high"]), (-1, swings["low"])):
            if broke_level(broken_swing, closes[index], closes[index - 1], side):
                level = chosen_level(model, side, trend, swings)
                # The level must sit behind the close, or price could never come back and reject it.
                if not math.isnan(level) and (closes[index] - level) * side > 0:
                    watched = dict(side=side, level=level, born=index)
                trend = side
    return found
