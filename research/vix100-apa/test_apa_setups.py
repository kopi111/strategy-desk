"""Checks the new APA setups. Run: python3 test_apa_setups.py"""
import pandas as pd

from apa_setups import find_setups
from search import load_history, shuffled_candles

HOUR = pd.Timedelta(hours=1)


def candles_from(rows):
    """Builds an hourly candle table from (open, high, low, close) rows."""
    times = pd.date_range("2026-01-01", periods=len(rows), freq="1h")
    return pd.DataFrame(rows, columns=list("ohlc"), index=times, dtype=float)


def test_retest_of_a_broken_high_gives_a_buy():
    """A swing high at 110 is broken, then a candle dips to it and closes above: one buy, known at that close."""
    rise = [(100 + step, 101 + step, 99 + step, 100 + step) for step in range(6)]
    peak = [(105, 110, 104, 105)]
    fall = [(105 - step, 106 - step, 103 - step, 104 - step) for step in range(6)]
    breakout = [(100, 116, 100, 115)]
    retest = [(115, 116, 109, 113)]
    candles = candles_from(rise + peak + fall + breakout + retest)
    setups = find_setups(candles, "sbr_rbs", HOUR)
    assert len(setups) == 1, setups
    assert setups[0]["side"] == 1
    assert setups[0]["known_at"] == candles.index[-1] + HOUR


def test_setups_never_change_when_future_candles_are_added():
    """Cutting off the later data must leave every earlier setup the same, or the code is peeking ahead."""
    bars = load_history(None)["R_100"].iloc[:30000].resample("1h").agg(
        {"o": "first", "h": "max", "l": "min", "c": "last"}).dropna()
    cut = len(bars) * 2 // 3
    for model in ("sweep", "sbr_rbs", "qm"):
        whole = find_setups(bars, model, HOUR)
        partial = find_setups(bars.iloc[:cut], model, HOUR)
        end = bars.index[cut - 1] + HOUR
        assert partial == [s for s in whole if s["known_at"] <= end], model
        assert partial, f"{model} found nothing, so this test proved nothing"


def test_shuffle_keeps_candle_shapes_and_joins_candles_up():
    """Shuffled candles must be valid, join end to end, and hold the same set of candle moves."""
    original = load_history(None)["R_100"].iloc[:5000]
    mixed = shuffled_candles(original, seed=7)
    assert (mixed.c.iloc[:-1].to_numpy() - mixed.o.iloc[1:].to_numpy()).max() < 1e-6
    assert (mixed.h >= mixed[["o", "c"]].max(axis=1) - 1e-9).all()
    assert abs(sorted(mixed.c / mixed.o)[100] - sorted(original.c / original.o)[100]) < 1e-12


if __name__ == "__main__":
    test_retest_of_a_broken_high_gives_a_buy()
    test_setups_never_change_when_future_candles_are_added()
    test_shuffle_keeps_candle_shapes_and_joins_candles_up()
    print("all tests passed")
