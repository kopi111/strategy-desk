"""Checks the two popular Boom/Crash formulas on 90 days of Deriv 1-minute candles.

1. "Trade the drift": sell Boom / buy Crash between spikes. Pays only if the drift outweighs the spikes,
   i.e. the average move over a holding period is not zero.
2. "Catch the spike after a long quiet spell": pays only if a spike gets more likely the longer it has
   been since the last one (if spikes are random, the wait makes no difference).
"""
import numpy as np
import pandas as pd

from backtest_apa import load_minutes

HOLDS = [5, 30, 120, 1440]


def spike_minutes(minutes, boom):
    move = (minutes.close - minutes.open) / minutes.open
    threshold = move.abs().quantile(0.5) * 20
    return (move > threshold) if boom else (move < -threshold)


def drift_report(symbol, minutes, boom):
    closes = minutes.close.values
    print(f"\n{symbol}  ({'sell' if boom else 'buy'} the drift; positive = formula makes money before costs)")
    for hold in HOLDS:
        change = (closes[hold:] - closes[:-hold]) / closes[:-hold] * (-1 if boom else 1)
        samples = change[::hold]
        t = samples.mean() / (samples.std(ddof=1) / np.sqrt(len(samples)))
        print(f"  hold {hold:>4} min: avg {samples.mean() * 1e4:+.2f} bp per trade, win {np.mean(samples > 0):.0%}, t {t:+.2f}, n {len(samples)}")


def hazard_report(spikes):
    flags = spikes.values
    since = np.zeros(len(flags), dtype=int)
    for i in range(1, len(flags)):
        since[i] = 0 if flags[i - 1] else since[i - 1] + 1
    frame = pd.DataFrame({"since": since, "spike": flags})
    buckets = pd.cut(frame.since, [-1, 100, 300, 600, 1000, 2000, 10**6],
                     labels=["0-100", "100-300", "300-600", "600-1000", "1000-2000", "2000+"])
    table = frame.groupby(buckets, observed=True).spike.agg(["mean", "count"])
    print("  chance of a spike next minute, by minutes since the last spike:")
    for label, row in table.iterrows():
        print(f"    {label:>9}: {row['mean']:.4f}  (n {int(row['count'])})")


for symbol in ["BOOM1000", "BOOM500", "CRASH1000", "CRASH500"]:
    minutes = load_minutes(symbol)
    boom = symbol.startswith("BOOM")
    drift_report(symbol, minutes, boom)
    spikes = spike_minutes(minutes, boom)
    print(f"  spikes found: {int(spikes.sum())} (about 1 per {len(spikes) / max(spikes.sum(), 1):.0f} min)")
    hazard_report(spikes)
