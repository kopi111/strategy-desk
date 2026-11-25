"""Neighbourhood check around the best RSI + 15m break-of-structure strategy on V100, V100(1s), V75, V75(1s).

A real edge should stay profitable when its settings are nudged; a fluke only works at one exact setting.
Grid (fixed before results): RSI period 10/14/21, levels 35/65, 40/60, 45/55, direction lasts 1/2/3 4H candles,
15m swing size 2/3, stop 1.5/2/2.5/3 ATR or structure, RR 2/3/4.

Run:  python3 structure_refine.py
"""
import itertools
from multiprocessing import Pool

import numpy as np
import pandas as pd

import structure_search as base
from structure_search import (MARKETS, CandleArrays, PERIOD_B_START, average_true_range, build_bars, cost_per_trade,
                              load_candles, rsi_reversal, simulate, structure_entries)

PERIODS = (10, 14, 21)
LEVELS = ((35, 65), (40, 60), (45, 55))
BIAS_LENGTHS = (1, 2, 3)
SWINGS = (2, 3)
STOPS = (1.5, 2.0, 2.5, 3.0, "structure")
TARGETS = (2.0, 3.0, 4.0)
SIGNAL_MINUTES = 240
OUTPUT_FILE = base.OUTPUT_FOLDER / "neighbourhood.csv"


def grid():
    """This function lists every nearby setting."""
    return list(itertools.product(PERIODS, LEVELS, BIAS_LENGTHS, SWINGS, STOPS, TARGETS))


def run_market(market):
    """This function plays every nearby setting on one market and returns its period A and B results."""
    candles = load_candles(market)
    arrays, cost = CandleArrays.from_candles(candles), cost_per_trade(market, candles)
    split = int(np.searchsorted(candles.index.values, PERIOD_B_START.to_datetime64()))
    signal_bars, entry_bars = build_bars(candles, SIGNAL_MINUTES), build_bars(candles, 15)
    entry_atr = average_true_range(entry_bars).to_numpy()
    rows, bias_cache = [], {}
    for period, (low, high), bias_length, swing, stop, target in grid():
        key = (period, low, bias_length)
        if key not in bias_cache:
            base.BIAS_CANDLES = bias_length
            bias_cache[key] = base.bias_on_entry_bars(signal_bars, entry_bars, rsi_reversal(signal_bars, period, low, high),
                                                      SIGNAL_MINUTES)
        signals, risk = structure_entries(entry_bars, bias_cache[key], swing, stop, entry_atr)
        trades = simulate(arrays, entry_bars.first_candle.to_numpy(), signals, risk, 1.0, target, cost)
        in_b = trades.entry >= split
        rows.append({"market": market, "period": period, "levels": f"{low}/{high}", "bias": bias_length, "swing": swing,
                     "stop": str(stop), "rr": target, "trades": len(trades), "wins": int((trades.net_r > 0).sum()),
                     "R_A": trades.net_r[~in_b].sum(), "R_B": trades.net_r[in_b].sum()})
    return rows


def main():
    """This function runs all four markets in parallel and saves one row per market and setting."""
    with Pool(4) as pool:
        rows = sum(pool.map(run_market, MARKETS), [])
    pd.DataFrame(rows).to_csv(OUTPUT_FILE, index=False)


if __name__ == "__main__":
    main()
