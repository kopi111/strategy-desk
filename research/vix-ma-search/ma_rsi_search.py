"""Moving average + RSI strategies across all 18 Volatility indices, same method and luck check as ma_search.py.

Entry rules, fixed before any result was seen (EMA and SMA each):
  * trend_dip:   close above a rising MA, RSI crosses back up through the oversold level -> buy (mirror for sell).
  * cross_rsi:   close crosses above the MA while RSI(14) is above 50 -> buy (mirror for sell).
  * pair_rsi:    fast MA crosses above slow MA while RSI(14) is above 50 -> buy (mirror for sell).
Each on 15m / 30m / 1H / 4H, stop 1 / 2 / 3 ATR, exit RR 1 / 2 / 3 or the opposite signal.

Run:  python3 ma_rsi_search.py [shuffled_histories]     (default 20)
"""
import sys

import ma_search
from ma_search import SLOPE_LOOKBACK, Setting, moving_average
from rules import crossed_above, relative_strength_index, signals_from

TREND_LENGTHS = (21, 50, 100, 200)
DIP_LEVELS = {2: (10, 20), 7: (30, 40), 14: (30, 40)}
CROSS_LENGTHS = (9, 21, 50, 100)
RSI_PAIRS = ((9, 21), (21, 50), (50, 200))
CONFIRM_PERIOD = 14
MIDDLE = 50


def trend_dip(bars, average, length, period, oversold):
    """This function buys when RSI turns up out of oversold while price is above a rising MA, and mirrors it."""
    line = moving_average(bars.close, average, length)
    rsi = relative_strength_index(bars.close, period)
    uptrend = (bars.close > line) & (line > line.shift(SLOPE_LOOKBACK))
    downtrend = (bars.close < line) & (line < line.shift(SLOPE_LOOKBACK))
    buy = uptrend & (rsi > oversold) & (rsi.shift(1) <= oversold)
    sell = downtrend & (rsi < 100 - oversold) & (rsi.shift(1) >= 100 - oversold)
    return signals_from(buy, sell)


def cross_rsi(bars, average, length):
    """This function buys a close crossing above the MA with RSI above 50, and mirrors it for sells."""
    line = moving_average(bars.close, average, length)
    rsi = relative_strength_index(bars.close, CONFIRM_PERIOD)
    return signals_from(crossed_above(bars.close, line) & (rsi > MIDDLE), crossed_above(line, bars.close) & (rsi < MIDDLE))


def pair_rsi(bars, average, fast, slow):
    """This function buys a fast-over-slow MA cross with RSI above 50, and mirrors it for sells."""
    fast_line, slow_line = moving_average(bars.close, average, fast), moving_average(bars.close, average, slow)
    rsi = relative_strength_index(bars.close, CONFIRM_PERIOD)
    return signals_from(crossed_above(fast_line, slow_line) & (rsi > MIDDLE),
                        crossed_above(slow_line, fast_line) & (rsi < MIDDLE))


def entry_rules():
    """This function lists every MA + RSI entry rule with its average type and settings."""
    rules = []
    for average in ("EMA", "SMA"):
        rules += [("trend_dip", average, (length, period, level)) for length in TREND_LENGTHS
                  for period, levels in DIP_LEVELS.items() for level in levels]
        rules += [("cross_rsi", average, (length,)) for length in CROSS_LENGTHS]
        rules += [("pair_rsi", average, pair) for pair in RSI_PAIRS]
    return rules


def every_setting():
    """This function lists every setting in a fixed order, the same for every market and history."""
    return [Setting(rule, average, lengths, minutes, stop, target) for rule, average, lengths in entry_rules()
            for minutes in ma_search.TIMEFRAMES for stop in ma_search.STOPS for target in ma_search.TARGETS]


ma_search.RULES = {"trend_dip": trend_dip, "cross_rsi": cross_rsi, "pair_rsi": pair_rsi}
ma_search.every_setting = every_setting
ma_search.OUTPUT_FOLDER = ma_search.OUTPUT_FOLDER.parent / "output-ma-rsi"

if __name__ == "__main__":
    ma_search.main()
