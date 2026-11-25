"""Runs the same APA rules on random walks with each symbol's own 1-minute volatility.

Anything the real backtest shows that these coin-flip markets also show is luck, not skill.
Run: python3 luck_control.py [runs_per_symbol]
"""
import json
import sys

import numpy as np
import pandas as pd

from backtest_apa import HERE, SYMBOLS, TARGET_MULTIPLES, load_minutes, run_frame, summarise


def random_walk_like(minutes, generator):
    log_returns = np.diff(np.log(minutes.close.values))
    steps = generator.normal(0, log_returns.std() / 2, size=(len(minutes), 4))
    path = minutes.close.iloc[0] * np.exp(np.cumsum(steps.ravel()))
    ticks = path.reshape(len(minutes), 4)
    return pd.DataFrame({"open": ticks[:, 0], "high": ticks.max(axis=1),
                         "low": ticks.min(axis=1), "close": ticks[:, -1]}, index=minutes.index)


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    generator = np.random.default_rng(7)
    report = {}
    for multiple in TARGET_MULTIPLES:
        pooled = []
        for symbol in SYMBOLS:
            minutes = load_minutes(symbol)
            for _ in range(runs):
                pooled += run_frame(f"walk-{symbol}", random_walk_like(minutes, generator), multiple)
        report[f"{multiple}R"] = summarise(pooled)
        print(f"{multiple}R", json.dumps(report[f"{multiple}R"]), flush=True)
    (HERE / "output" / "luck_control.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
