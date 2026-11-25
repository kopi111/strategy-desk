"""Checks the parts that could silently fake a result. Run: python3 test_quant.py"""
import unittest

import numpy as np
import pandas as pd

from engine import CandleArrays, simulate
from metrics import longest_run, max_drawdown
from rules import RULE_VARIATIONS, average_true_range, build_bars, signals_for
from search import market_regimes, shuffled_candles


def random_walk_candles(count=6000, seed=7):
    """Makes artificial 5-minute candles so the tests need no download."""
    random = np.random.default_rng(seed)
    closes = 1000 * np.exp(np.cumsum(random.normal(0, 0.001, count)))
    opens = np.concatenate(([1000.0], closes[:-1]))
    wick = np.abs(random.normal(0, 0.0005, count)) * closes
    index = pd.date_range("2026-01-01", periods=count, freq="5min")
    return pd.DataFrame({"open": opens, "high": np.maximum(opens, closes) + wick,
                         "low": np.minimum(opens, closes) - wick, "close": closes}, index=index)


def flat_candles(rows):
    """Builds candles from (open, high, low, close) rows for hand-checked trades."""
    index = pd.date_range("2026-01-01", periods=len(rows), freq="5min")
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=index)


def play(rows, signals, atr, reward_risk, cost=0.0):
    """Runs one simulated strategy where every 5-minute candle is also a signal bar."""
    return simulate(CandleArrays.from_candles(flat_candles(rows)), np.arange(len(rows)),
                    np.array(signals, dtype=np.int8), np.array(atr, dtype=float), 1.0, reward_risk, cost)


class NoLookAheadTests(unittest.TestCase):
    """If a rule used future candles, cutting off the future would change its past signals."""

    def test_signals_do_not_change_when_future_candles_are_removed(self):
        candles = random_walk_candles()
        for minutes in (15, 60):
            full_bars = build_bars(candles, minutes)
            short_bars = build_bars(candles.iloc[:4500], minutes)
            for rule, parameters in RULE_VARIATIONS:
                full = signals_for(full_bars, average_true_range(full_bars), rule, parameters, "any")
                short = signals_for(short_bars, average_true_range(short_bars), rule, parameters, "any")
                self.assertTrue(np.array_equal(full[:len(short)], short), f"{rule}{parameters} {minutes}m looks ahead")

    def test_regime_labels_do_not_change_when_future_days_are_removed(self):
        candles = random_walk_candles(count=20000)
        full, short = market_regimes(candles), market_regimes(candles.iloc[:15000])
        self.assertTrue(np.array_equal(full[:15000], short))


class TradeTests(unittest.TestCase):
    """Small trades worked out by hand."""

    def test_buy_reaches_target_and_fills_on_next_open(self):
        # The last candle is only an exit point, so a fourth candle lets the third one be checked.
        rows = [(100, 100, 100, 100), (101, 102, 100.5, 101.5), (101.5, 103.5, 101, 103), (103, 103, 103, 103)]
        trades = play(rows, [1, 0, 0, 0], [2, 2, 2, 2], 1.0)
        self.assertAlmostEqual(trades.net_r[0], 1.0)
        self.assertEqual(trades.entry[0], 1)
        self.assertEqual(trades.exit[0], 2)

    def test_stop_wins_when_both_are_touched_in_one_candle(self):
        rows = [(100, 100, 100, 100), (100, 103, 97, 100), (100, 100, 100, 100)]
        self.assertAlmostEqual(play(rows, [1, 0, 0], [2, 2, 2], 1.0).net_r[0], -1.0)

    def test_sell_stop_and_cost(self):
        rows = [(100, 100, 100, 100), (100, 103, 99, 102), (102, 102, 102, 102)]
        self.assertAlmostEqual(play(rows, [-1, 0, 0], [2, 2, 2], 1.0, cost=0.5).net_r[0], -1.25)

    def test_gap_past_the_stop_fills_at_the_worse_open(self):
        rows = [(100, 100, 100, 100), (100, 100.5, 99, 99), (95, 95.5, 94, 95), (95, 95, 95, 95)]
        self.assertAlmostEqual(play(rows, [1, 0, 0, 0], [2, 2, 2, 2], None).net_r[0], -2.5)

    def test_only_one_trade_at_a_time(self):
        rows = [(100, 100.5, 99.5, 100)] * 6
        self.assertEqual(len(play(rows, [1, 1, 1, 1, 1, 0], [50] * 6, 1.0)), 1)


class ShuffleAndMetricTests(unittest.TestCase):
    """The luck check must stay fair and the measurements correct."""

    def test_shuffle_keeps_candle_shapes_and_valid_prices(self):
        candles = random_walk_candles(count=500)
        shuffled = shuffled_candles(candles, 3)
        self.assertTrue(((shuffled.high >= shuffled[["open", "close"]].max(axis=1) - 1e-9)).all())
        self.assertTrue(((shuffled.low <= shuffled[["open", "close"]].min(axis=1) + 1e-9)).all())
        self.assertAlmostEqual(np.sort(shuffled.close / shuffled.open).sum(), np.sort(candles.close / candles.open).sum(), places=6)

    def test_streak_and_drawdown(self):
        self.assertEqual(longest_run(np.array([True, True, False, True, True, True])), 3)
        self.assertAlmostEqual(max_drawdown(np.array([1.0, -2.0, -1.0, 4.0])), 3.0)


if __name__ == "__main__":
    unittest.main()
