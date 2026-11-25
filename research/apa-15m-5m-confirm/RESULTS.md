# APA – 15m setup, 5m confirmation candle (2026-11-06)

Prompt: `~/Desktop/strategy-improvement-prompt.txt`. Code: `backtest_mtf.py` (engine), `study.py` (steps).
Pine: `apa-15m-setup-5m-confirm.pine` (also on the Desktop). Tables: `output/results_gold.csv`, `output/results_vix.csv`;
final trades: `output/final_trades_gold.csv`, `output/final_trades_vix.csv`; log: `output/vix.log`.

Rules: 15m CINCO APA sweep (only known when the 15m candle closes) → wait up to 3 × 15m for a 5m candle in the
trade's colour that confirms (break of the sweep candle / 5m CHoCH / 5m engulfing). Cancelled if a 5m candle closes
past the sweep candle's far end. Entry 5m close, stop = sweep extreme (+ ATR buffer), target RR × risk, stop/target
live from the next 5m candle (TradingView OHLC path). One spread charged per trade.
Data: gold = HistData M1 Oct 2023 – Sep 2026, 15m and 5m both built from it, split 2025-03-31.
Vix = Deriv 5m Nov 2025 – Nov 2026 (all 18 indices), 15m built from it, split 2026-05-03. Choices made on half A only.

## Gold (XAUUSD) — 10 ideas tried
| Idea | Trades | Win % | Need | Net R | t | Half A | Half B | Stop (spreads) | $200 → |
|---|---|---|---|---|---|---|---|---|---|
| break | 201 | 43.8 | 40.0 | +8.7 | 0.49 | −4.9 | +13.6 | 27.6 | 215 |
| **choch** | 137 | 48.2 | 40.0 | +23.1 | 1.57 | +8.7 | +14.5 | 40.8 | 249 |
| engulf | 188 | 43.1 | 40.0 | +2.1 | 0.12 | +6.8 | −4.7 | 21.7 | 201 |
| choch + stop 0.5 ATR | 132 | 49.2 | 40.0 | +26.6 | 1.84 | +10.8 | +15.8 | 46.9 | 258 |
| choch + daily EMA50 | 72 | 45.8 | 40.0 | +8.1 | 0.76 | +3.8 | +4.3 | 41.2 | 216 |
| choch + RR 1.0 | 140 | 53.6 | 50.0 | +5.2 | 0.44 | −2.2 | +7.4 | 41.2 | 209 |
| choch + RR 2.0 | 131 | 42.7 | 33.3 | +32.5 | 1.91 | +14.0 | +18.5 | 40.8 | 273 |
| choch + window 1 × 15m | 75 | 50.7 | 40.0 | +17.7 | 1.62 | +5.9 | +11.7 | 44.6 | 237 |
| choch + London/NY hours | 92 | 47.8 | 40.0 | +14.9 | 1.24 | +4.3 | +10.6 | 42.4 | 230 |
| **FINAL choch + 0.5 ATR + RR 2.0** | **126** | **43.7** | **33.3** | **+35.3** | **2.10** | **+13.5 (t 1.15)** | **+21.8 (t 1.81)** | 47.6 | **281** |

Final by year: 2023 (Oct–Dec) −0.4R / 9 · 2024 +10.4R / 42 · 2025 +12.8R / 43 · 2026 +12.5R / 32.
Buys +15.1R / 67, sells +20.2R / 59 → not just gold's uptrend. Worst drawdown −9.4R, longest losing run 6,
median hold 5 h. Spread is small here (stop ≈ 48 spreads), so costs are not the problem they were on plain 15m.
Compare: plain 15m APA on gold lost −60.9R; 15m with a 15m confirmation candle lost money too.

**Verdict: promising but unproven.** t 2.1 overall, but under 2 in each half; one market only; 10 ideas tried.
Do not trust: the exact RR 2.0 (RR 1.5 vs 2.0 is a choice made on the data), the $200 → $281 figure (no slippage,
no news spikes), the 5m CHoCH swing length 3 (never varied – keep it, don't tune it).
Next step: forward-test it (watcher + tracker), and test it on the 7 USD pairs as the out-of-market check.

## Vix (all 18 Deriv Volatility indices) — 9 ideas tried
| Idea | Trades | Win % | Need | Net R | t | Half A | Half B | Markets + |
|---|---|---|---|---|---|---|---|---|
| break | 1459 | 40.1 | 40.0 | −131.9 | −2.82 | −58.2 | −73.6 | 5/18 |
| choch | 573 | 40.5 | 40.0 | −31.5 | −1.07 | −8.9 | −22.7 | 5/18 |
| engulf | 994 | 39.2 | 40.0 | −141.1 | −3.66 | −49.5 | −91.6 | 4/18 |
| choch + stop 0.5 ATR | 568 | 41.7 | 40.0 | −7.6 | −0.26 | +3.6 | −11.2 | 8/18 |
| choch + daily EMA50 | 305 | 39.3 | 40.0 | −23.8 | −1.11 | −2.1 | −21.8 | 7/18 |
| choch + RR 1.0 | 574 | 50.9 | 50.0 | −28.5 | −1.19 | −18.9 | −9.7 | 6/18 |
| choch + RR 2.0 | 569 | 33.7 | 33.3 | −31.2 | −0.92 | −1.8 | −29.5 | 5/18 |
| choch + window 1 × 15m | 186 | 34.4 | 40.0 | −39.4 | −2.42 | −32.1 | −7.3 | 5/18 |
| FINAL choch + 0.5 ATR + EMA50 + RR 2.0 | 304 | 34.9 | 33.3 | −1.9 | −0.07 | +9.8 | −11.7 | 11/18 |

**Verdict: no edge.** Every version loses after spread; win rate sits on the break-even line (random-number markets).
The best version made money in half A and lost it in half B. Do not trade APA on Vix.

## Out-of-market check: gold's FINAL settings on the 7 USD pairs (no tuning) — `fx_check.py`
| Pair | Trades | Win % (need 33.3) | Net R | t | Half A | Half B | Stop (spreads) | $200 → |
|---|---|---|---|---|---|---|---|---|
| EURUSD | 121 | 34.7 | −5.6 | −0.35 | −1.9 | −3.6 | 13.9 | 187 |
| GBPUSD | 130 | 28.5 | −28.0 | −1.81 | −13.7 | −14.3 | 17.1 | 149 |
| USDJPY | 142 | 34.5 | +2.6 | 0.15 | +4.8 | −2.2 | 29.5 | 202 |
| AUDUSD | 130 | 35.4 | −2.8 | −0.17 | −8.4 | +5.6 | 14.8 | 192 |
| NZDUSD | 129 | 30.2 | −24.4 | −1.55 | −14.6 | −9.8 | 13.6 | 155 |
| USDCAD | 126 | 32.5 | −12.2 | −0.77 | −16.7 | +4.5 | 15.2 | 175 |
| USDCHF | 148 | 33.1 | −13.2 | −0.76 | −11.1 | −2.1 | 13.2 | 173 |
| **All 7** | **926** | **32.7** | **−83.6** | **−1.94** | −61.6 | −21.9 | 16.3 | 79 |

**The gold result does NOT carry over:** 6 of 7 pairs lose. So the gold edge is either gold-specific or luck
from the 10 ideas tried. Downgrade gold to "unproven, likely luck" until a forward test says otherwise.

## 60% win-rate round (2026-11-06) — `winrate_study.py`, `output/winrate_gold.csv`, `output/winrate_vix.csv`, `output/winrate.log`
Win = trade made money AFTER spread (break-even exits are not wins). 10 ideas: smaller targets, wider stops, partial profit
(+ stop to break-even). Pick = most half-A R among ideas with ≥60% wins in half A; half B is the check.

Gold: pick **RR 0.75, stop 1.0 ATR** → 138 trades, **60.9% wins (A 60.3 / B 61.4)**, +5.5R (A +1.3 / B +4.2), t 0.55,
$500 → $526 in 3 years. Passes the 60% + profit check, but the profit is tiny and not significant.
Higher win rates lose money: RR 0.5 = 67.6% wins, −1.6R; 70% off at 0.5R = 66.7%, −0.3R.
More profit comes with fewer wins: half off at 1R, rest 2R, BE = 55.4%, +20.9R; original RR 2.0 = 43.7%, +35.3R.
7 USD pairs with gold's pick, unchanged: 55.5% wins, −91.5R, 1/7 pairs up (only USDCHF 62.6%, +3.8R).
Vix (18): no idea reached 60% with profit; RR 0.5 gives 67.4% wins and −22R.
Verdict: 60%+ is reachable only by trading profit for win rate; at 60% this strategy is ≈ break-even.

## Independent audit (reality-checker agent, 2026-11-06)
No look-ahead or fill bug inflating gold: truncation test (trades identical when data is cut), M1 replay of all 126
trades (0 changed), ask-side shorts and spread 0.8 still +29R. Found: HistData timezone is US Eastern WITH DST, not
fixed EST (summer bars ~1 h late) — only affects the hours filter and daily-EMA day start, not the FINAL settings.
Weakness is statistical (idea selection, no transfer to FX), not code.
