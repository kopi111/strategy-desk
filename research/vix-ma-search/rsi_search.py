"""RSI-only strategies across all 18 Volatility indices, same method and luck check as ma_search.py.

Entry rules, fixed before any result was seen:
  * reversal:  RSI crosses back up through the oversold level -> buy; back down through overbought -> sell.
  * momentum:  RSI crosses above the middle line -> buy; below it -> sell.
  * breakout:  RSI crosses above the overbought level -> buy; below oversold -> sell.
RSI periods 2 / 7 / 14 / 21, each on 15m / 30m / 1H / 4H, stop 1 / 2 / 3 ATR, exit RR 1 / 2 / 3 or opposite signal.

Run:  python3 rsi_search.py [shuffled_histories]     (default 20)
"""
import ma_search
from ma_search import Setting
from rules import relative_strength_index, signals_from

LEVELS = {2: ((10, 90), (5, 95)), 7: ((30, 70), (20, 80)), 14: ((30, 70), (20, 80), (40, 60)), 21: ((30, 70), (40, 60))}
MIDDLES = {2: (50,), 7: (50,), 14: (50,), 21: (50,)}


def crossed_up(rsi, level):
    """This function is true on the candle where RSI moves from at-or-below the level to above it."""
    return (rsi > level) & (rsi.shift(1) <= level)


def crossed_down(rsi, level):
    """This function is true on the candle where RSI moves from at-or-above the level to below it."""
    return (rsi < level) & (rsi.shift(1) >= level)


def reversal(bars, average, period, low, high):
    """This function buys RSI turning up out of oversold and sells RSI turning down out of overbought."""
    rsi = relative_strength_index(bars.close, period)
    return signals_from(crossed_up(rsi, low), crossed_down(rsi, high))


def momentum(bars, average, period, middle):
    """This function buys RSI crossing above the middle line and sells it crossing below."""
    rsi = relative_strength_index(bars.close, period)
    return signals_from(crossed_up(rsi, middle), crossed_down(rsi, middle))


def breakout(bars, average, period, low, high):
    """This function buys RSI pushing above overbought and sells it pushing below oversold."""
    rsi = relative_strength_index(bars.close, period)
    return signals_from(crossed_up(rsi, high), crossed_down(rsi, low))


def entry_rules():
    """This function lists every RSI entry rule with its settings."""
    rules = [(name, "RSI", (period, low, high)) for name in ("reversal", "breakout")
             for period, pairs in LEVELS.items() for low, high in pairs]
    rules += [("momentum", "RSI", (period, middle)) for period, middles in MIDDLES.items() for middle in middles]
    return rules


def every_setting():
    """This function lists every setting in a fixed order, the same for every market and history."""
    return [Setting(rule, average, values, minutes, stop, target) for rule, average, values in entry_rules()
            for minutes in ma_search.TIMEFRAMES for stop in ma_search.STOPS for target in ma_search.TARGETS]


ma_search.RULES = {"reversal": reversal, "momentum": momentum, "breakout": breakout}
ma_search.every_setting = every_setting
ma_search.OUTPUT_FOLDER = ma_search.OUTPUT_FOLDER.parent / "output-rsi"

if __name__ == "__main__":
    ma_search.main()
