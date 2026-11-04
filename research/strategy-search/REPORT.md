# Search for strategies winning over 55% with profit after spread (2026-11-03)
23 strategies (14 Desk setups, 9 classic) x 2 stops x 4 targets x EMA200 filter on/off x 5m/15m/1H, on gold, 7 forex pairs and 10 Vix markets, pooled by group.
Rules are picked on the first 70% of each market's history, then judged on the last 30%. Gold 1H rules are then run on 2016-2022 prices, unused until that step.
Assumed spreads, no swap. A rule's entry is the next candle's open. Full output: RESULTS.txt.
On a pure random walk the search averages about +0.011R, so a small optimistic lean remains and results of that size mean nothing.
A CRT detector bug (firing one candle early on misaligned candle times) was found by this check and fixed; it did not change real-market results.
