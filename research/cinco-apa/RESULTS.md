# CINCO APA – Invalidation Strategy (Pine v6) – backtest 2026-11-05

Port: `backtest.py` (same rules as the Pine script: swing 5, RR 2, entry at signal-bar close, stop = signal-bar low/high,
exit placed on the next bar, TradingView OHLC path for intrabar fills). Costs = one spread per trade (dashboard spreads).
Data: HistData M1 Oct 2023 – Sep 2026 (gold + 7 USD pairs); Deriv 1 year (V25, V75, V100, Step 200).
Full table: `output/summary.csv`; every trade: `output/trades.csv`.

Pooled, gold + forex:
| TF | Trades | Win % | Gross R | Net R | t |
|---|---|---|---|---|---|
| 15m | 3806 | 35.4 | −299.8 | −1668.5 | −10.6 |
| 1H | 870 | 37.4 | +13.1 | −120.3 | −1.9 |
| 4H | 222 | 38.3 | +16.1 | −9.7 | −0.3 |

Gold: 15m −60.9R, 1H −20.5R, 4H −18.2R. 1H by year: every year negative.
Deriv synthetics: 5m −1291R; 1H −2.9R; 4H −12.9R.
Verdict: no edge. Before costs ≈ break-even (needs 33.3% wins at 2R; gets 35–38%, but 14.5% of losers are worse than −1R
because the stop is only placed the bar after entry). On 15m/5m the stop is only 3–11 spreads wide, so spread eats it.
Script sizing (1% of equity as position value, no stop-based sizing) means $1000 moves by cents: dollar P&L is meaningless.

## Confirmation candle (2026-11-05) — `confirm.py`, Pine `cinco-apa-confirmation.pine`
Wait after the sweep for a candle in the trade's colour closing past the sweep candle's high/low (break(N) = N candles allowed);
cancel if price closes past the sweep candle's far end; stop = sweep extreme, placed on the entry bar.
Gold+forex net R (t): 15m original −1669 (−10.6) → break(1) −94 (−2.2); 1H −120 → −23 (−1.1); 4H −10 → +14.9 (t 1.5, 41 trades,
both halves +, 5/8 markets +). Engulfing confirmation worse. Losses shrink mainly because there are far fewer trades;
before-cost result is still ≈0 on 15m/1H. 4H break(1) is the only positive line and is not statistically significant.

## Win-rate sweep (2026-11-05) — `winrate.py`, `output/winrate_sweep.csv` (break(1), gold+forex)
4H RR 1.5: 53.7% win (needs 40%), +12.9R / 41 trades, t 1.6, +6.3R / +6.6R halves, 6/8 markets.
4H RR 1.5 + EMA200: 56% win, +9.5R / 25 trades, 7/8 markets. 4H RR 1.0: 55% win but only +2.9R.
1H: every RR/EMA combo loses (best RR1 EMA200: 50.4% win, −4.9R). Pine default now RR 1.5, EMA filter optional (off).

## Win rate round 2 (2026-11-05) — `winrate2.py`, `output/winrate2.csv`, `output/winrate2_final_trades.csv`
10 ideas × 1H/2H/4H, picked on half A (to 2025-03), checked on half B. Only two held in both halves:
stop 0.5 ATR past the sweep, and yesterday's daily EMA50 trend filter. Session filter, break-even at 1R, RR 1.2, swing 3/8 did not.
2H + ATR0.5 + daily EMA50: 59.5% win, +17.2R / 37 trades, t 2.27, A +12.5 / B +4.6, 7/8 markets.
4H + ATR0.5 only: 56.1% win, +15.7R / 41 trades, t 1.96 (combo on 4H was worse: 50%).
≈40 settings tried in total, so t ≈ 2.3 is not proof. Pine now defaults to these (made for 2H).

## Round 3: 65% on 15m / 30m / 1H? (2026-11-05) — `winrate3.py`, `output/winrate3.csv`
Grid RR 0.5/0.75/1.0 × stop buffer 0.5/1.0 ATR, with confirmation + daily EMA50.
65% is reachable only with RR 0.5 (needs 66.7% to break even): 15m 63.8% −57.9R (0/8 mkts), 30m 64.9% −20.4R,
1H 69.1% +1.1R / 123 trades (t 0.14, second half −2.0R). On every TF the win rate rises exactly as fast as the
break-even rate, so there is no edge on 15m/30m/1H; spread is the difference. Pine defaults NOT changed.

## Vix (all 18 Deriv Volatility indices, 1 year 15m → 30m/1H/2H/4H) (2026-11-05) — `vix.py`, `output/vix_summary.csv`
Original 1H: −145R, $200→$35. 15m RR0.5: 67.4% win (need 66.7) −18.6R → $164. 30m: 65.1% −11R → $178.
1H RR0.5 ATR1: 72% win +5.3R t 0.8 → $210. 1H/2H/4H RR1.5: 42–43% win, +1 to +3R, t ≤ 0.35 → $201–205.
Win rate hits 65–72% but always ≈ break-even line; Vix is RNG, no pattern can have an edge. Gold/forex results do not carry over.

## Step indices (all 5, 1 year 15m) (2026-11-05) — `vix.py step*`, `output/step*_summary.csv`
Step 400/500 spreads ASSUMED (0.4/0.5). 30m RR0.5 looked great on Step 100/200/300 (85% win, +7.3R, t 2.6, 27 trades)
but on the check markets Step 400/500 it hit exactly 66.7% (= break-even), −0.2R. All 5: 77% win +7.1R t 1.6 (luck).
Original was −34.8R on Step 100-300 and +25.3R on 400/500: same rules flip sign = noise. No edge on Step (RNG).
