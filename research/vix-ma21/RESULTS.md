# 21 moving average on V100 and V100(1s) — 2026-11-13

**Verdict: no edge.** Pure luck on shuffled prices does as well as the 21 MA or better.

## What was tested (fixed before any result)
- **cross:** close crosses above the 21 MA → buy; below → sell.
- **pullback:** 21 MA rising over 5 candles, previous close above it, candle dips to the MA and closes back above it green → buy (mirror for sell).
- 21 EMA and 21 SMA · 15m / 30m / 1H / 4H · stop 1 / 2 / 3 ATR · exit RR 1 / 2 / 3 or opposite signal = **192 settings per market**.
- Data: 5-minute Deriv candles Nov 2025 – Nov 2026 (`../vix100-quant/data`). Fill at next candle open, stop counts first when both are hit in one candle, 0.5 cost per trade (assumed spread 0.4 + slippage 0.1).
- Choose on A (to 30 Jun 2026), score on B (1 Jul onward), then the same search on 40 shuffled histories.

## Results
| Market | Chosen on A | A | B (unseen) | Shuffles with a better A score |
|---|---|---|---|---|
| R_100 | cross SMA21 30m stop 3 ATR RR 1 | +33.2R (t 1.92, 302 tr) | **−1.5R** (177 tr) | 24 / 40 |
| 1HZ100V | cross SMA21 1H stop 2 ATR RR 1 | +30.8R (t 2.03, 234 tr) | **−5.0R** (123 tr) | 14 / 40 |

- Average setting loses money in every group (cross/pullback × EMA/SMA), both markets, both halves.
- Best in hindsight: R_100 **cross EMA21 15m stop 3 ATR RR 3 = +70.5R** for the year (+24.3 A, +46.2 B, t 1.93). 10 of 40 shuffled histories found a better best, and 21 of 40 a higher t. Settings that won both halves: real 24, shuffled median 24, the same as chance.
- V100(1s) is worse than chance: 39 of 40 shuffles found a better hindsight best.

## Files
`ma21_test.py` (run: `python3 ma21_test.py`, about 1 min), `output/luck_table.csv`, `output/all_tests_<market>.csv` (every setting, A/B/all), `output/hindsight_check.py` + `hindsight_luck.csv`.
