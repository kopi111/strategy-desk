# Does price return to fair value gaps on the Vix markets?

Asked 2026-11-03. Data: 10 Volatility indices (R_10-100, 1HZ10V-100V), 2025-11-03 to 2026-11-03, 5m / 15m / 1H.
199,191 gaps, using the same gap rule the Desk draws (checked against the Desk's code on every run).

## Answer
Price does come back: about 83% reach the gap edge within 20 candles, 92% within 100, 96% within 500.
But it reaches a fake level the same distance on the OTHER side just as often. The gap is reached first 50.0% of the
time on all three timeframes (shuffled candles: 50.0-50.6%). The return is what any nearby level gets on a random walk.
Gap size, direction and trend do not change this. Only distance changes the return rate, and it changes the fake level equally.

## Trading it, 15m, after spread (one trade at a time per market)
| Rule | Trades | Win | Before spread | After spread | Markets up |
|---|---|---|---|---|---|
| Trade back to the gap, 1:1 | 21,253 | 49.8% | -0.005R | -0.156R | 0/10 |
| Retest, 1R target | 30,518 | 49.6% | -0.008R | -0.144R | 0/10 |
| Retest, 2R target | 23,718 | 33.5% | +0.004R | -0.131R | 0/10 |
| Retest, 3R target | 19,014 | 25.0% | -0.001R | -0.135R | 0/10 |
Every rule on every timeframe loses after spread. 5m is worse and 1H less bad; best is 1H retest 3R, -0.038R, t -1.5, 2/10 markets up.

## Limits
Spreads are the Desk's assumed values, and three 1s markets borrow their sibling's. No swap is charged. Entry is the next candle's
open, not a limit fill. If stop and target are in one candle, the stop counts first.

## Simulator bug found and fixed
The first version took trades in gap-formation order, which looked into the future and showed 32.6% wins at 3R on a pure random walk
(fair: 25%). Trades now run in entry order. `bias-check.mjs` must pass before trusting any trading result here.

Run: `node research/fvg-return/bias-check.mjs` then `node research/fvg-return/study.mjs` (full tables in RESULTS.txt).

## Confirmation candles (added 2026-11-03)
`confirmation.mjs` tested 90 rules: engulfing, pin bar, rejection close, any of the three, and any of the three with the trend; gap or candle stop;
1R/2R/3R targets; 5m/15m/1H. Entry is the next candle's open. The confirmation must come within 5 candles of the touch.
0 of 90 were profitable after spread, on the first 70% or on all data. Win rates stayed at coin-flip odds (about 50% / 33% / 25%), and 36 of 90 were
above zero before spread, about what chance gives. Best on 15m: any of the three with the trend, gap stop: -0.077R at 1R, -0.083R at 3R, down from about -0.14R,
but before spread these are still about zero. Losses shrink because the entry is further from the stop, so the spread is a smaller share of the risk, not because more trades win.
Best picked on the first 70% (1H rejection close, gap stop, 3R): -0.031R, then -0.077R on the unseen 30%. Full tables: CONFIRMATION-RESULTS.txt.

## Gold, real prices (added 2026-11-03)
`gold.mjs`, HistData 1-minute candles, 2023-01-02 to 2026-10-01, price 1,827 to 4,176. Weekend jumps are excluded, stops that open past the level exit at the worse price.
Gaps still give no direction: gap reached before the same distance on the other side 49.8% (5m), 50.4% (15m), 50.0% (1H).
198 rules, assumed spread 0.30 at a price of 3,000. Rules profitable after spread: 5m 0/66, 15m 6/66, 1H 36/66. Average after spread: 5m -0.135R, 15m -0.071R, 1H +0.012R.
Best overall t is 1.3; none reach the 3.5 bar for this many rules. Buys beat sells on average, which fits gold's rally. No swap charged.
Best rule on both parts and both sides: 1H London + New York, pin bar, candle stop, 3R: +0.123R, n 234, t 1.0, first 70% +0.083R, last 30% +0.214R. Chosen after seeing all results, so it is a lead, not evidence.
Full tables: GOLD-RESULTS.txt.

## Outside test of the best gold lead (added 2026-11-03)
`pin-bar-older.mjs`: 1H, London + New York, pin bar after an FVG touch, candle stop, 3R, rule unchanged, on 2016-2022 gold. 474 trades, win 24.3% (coin-flip 25%), -0.079R after spread, t -1.0, total -37.6R, worst drop -62.0R, longest losing streak 18. Five of seven years lost. Lead rejected.
