# Stricter backtest: potential-trade rule on Volatility 25 (1s) (2026-11-10)

**Verdict: no edge. The rule does not make money on this market even with no spread.**

Script: `better-backtest.mjs`. Saved runs: `better-results/`. Data: Deriv 5m candles, 2025-11-03 to 2026-11-03.
Changes from `backtest.mjs`: exits followed on 5m candles, five spread levels, splits by time, side and stop size, 40 shuffled histories.

The Desk's 374-point spread for this market is assumed from a sibling market's share of price. It has not been measured.

| Group | Trades | Win % | Need % | Gross R/trade | Net at half spread | Net at full spread | Shuffled at or above real gross |
|---|---|---|---|---|---|---|---|
| All trades | 1,011 | 27.2 | 28.1 | -0.013 | -0.110 | -0.207 | 24 of 40 |
| Nov-Jun | 633 | 25.9 | 28.3 | -0.057 | -0.153 | -0.249 | 33 of 40 |
| Jul-Nov | 378 | 29.4 | 27.8 | +0.059 | -0.039 | -0.137 | 12 of 40 |
| Buys | 528 | 29.0 | 28.1 | +0.101 | +0.003 | -0.094 | 3 of 40 |
| Sells | 483 | 25.3 | 28.2 | -0.138 | -0.234 | -0.331 | 39 of 40 |
| Stop under 3 spreads | 33 | 6.1 | 17.8 | -0.688 | -0.870 | -1.052 | 39 of 40 |
| Stop 3-6 spreads | 596 | 26.0 | 26.8 | 0.000 | -0.111 | -0.223 | 18 of 40 |
| Stop 6+ spreads | 382 | 30.9 | 31.1 | +0.024 | -0.043 | -0.110 | 17 of 40 |
| Target 5R or more | 188 | 13.8 | 13.1 | +0.051 | -0.066 | -0.182 | 12 of 40 |
| Like the 11-10 sell (sell, 5R+, stop under 3 spreads) | 6 | 0.0 | 11.0 | -1.000 | -1.180 | -1.360 | 40 of 40 |

Notes:
- The gap between buys and sells was found after looking at 12 groups, so one group this far out is expected by chance. Buys are gross t 1.18.
- The group like the 11-10 sell has only 6 trades, which is too few to judge alone. Its parent group (33 trades) is also poor.
- Moving exits from 15m to 5m barely changed the result: -0.202R became -0.207R per trade.
