# APA on Volatility 100 and Volatility 100 (1s) (finished 2026-11-10)

**Verdict: no edge found. Do not trade any of these settings.**

Code: `apa_setups.py` (setups), `search.py` (search and luck check), `test_apa_setups.py` (tests, passing).
Tables: `output/real_grid.csv` (every setting), `output/luck_table.csv` (what each history would have picked), `output/search.log`.

## The test
- Data: Deriv 5m candles, Nov 2025 to 3 Nov 2026, higher timeframes built from them. Spread 0.4 on both markets, charged per trade.
- Models: hidden-invalidation sweep, SBR/RBS retest, QM left-shoulder retest. QM and SBR/RBS use swing wicks, not candle bodies.
- Grid: 3 models x 5 setup timeframes (15m to 4H) x 3 5m confirmations x RR 1/1.5/2/3 x stop buffer 0/0.5/1 ATR x daily EMA50 on/off = 1,080 settings.
- Choice: highest t value in period A (Nov to Jun), with at least 40 trades per market. Period B (Jul to Nov) only scores that choice.
- Luck check: the same search on 32 histories of shuffled 5m candles, where no pattern can exist.

## Results
| Track | Chosen setting | Period A | Period B (unseen) | Period B, double spread |
|---|---|---|---|---|
| R_100 | SBR/RBS 15m, break, RR3, 1 ATR, EMA50 | +23.44R, 169 trades, t 0.99 | -1.27R, 85 trades, t -0.08 | -5.53R |
| 1HZ100V | SBR/RBS 1H, CHoCH, RR3, 1 ATR, EMA50 | +18.92R, 60 trades, t 1.29 | -4.56R, 28 trades, t -0.52 | -5.11R |
| Both | SBR/RBS 1H, CHoCH, RR3, 1 ATR, EMA50 | +21.95R, 123 trades, t 1.08 | -27.90R, 66 trades, t -2.38 | -29.80R |

## Luck check (32 shuffled histories)
| Track | Median shuffled best t in A | Real best t in A | Shuffled at or above real | Shuffled picks profitable in B |
|---|---|---|---|---|
| R_100 | 1.84 | 0.99 | 30 of 32 | 44% |
| 1HZ100V | 1.75 | 1.29 | 28 of 32 | 28% |
| Both | 1.83 | 1.08 | 30 of 32 | 50% |

Real prices produced a weaker "best" than most shuffled histories did. No shuffled pick reached t 2 in period B.

## Price memory
Lag-1 autocorrelation of 5m moves: R_100 -0.0029, 1HZ100V +0.0019, both inside the random band of +/-0.0062.
Variance ratios from 3 to 288 candles: 0.95 to 1.00, within the sampling error of a random walk at the longest horizon.

## Limits
- One year of data, because Deriv keeps about a year of candles. Period B is about four months.
- An earlier study split the same Vix data at 2026-05-03, so period A is not completely fresh.
- Stop and target order inside a 5m candle uses the TradingView OHLC path.
- Spread values come from `js/core/instruments.js`; check them against a live MT5 account.
