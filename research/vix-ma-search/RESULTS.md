# Vix MA / RSI / structure search — 2026-11-13

All costs: spread from js/core/instruments.js + 25% slippage. Choose on A (Nov 2025 – Jun 2026), score on B (Jul – Nov 2026).

- **MA only** (ma_search.py, 4,032 settings, 18 Vix): avg −0.08R/trade. 21 MA on 15m: all 48 versions lose.
- **MA + RSI** (ma_rsi_search.py, 2,976): avg −0.084R/trade.
- **RSI only** (rsi_search.py, 1,056): avg −0.077R. Pick RSI14 reversal 40/60 4H stop 2 ATR RR1: B +15.6R (t 0.6). On V100/V100s/V75/V75s: 56.1% wins, +48.7R. Same on 15m: −297.6R.
- **RSI + structure** (structure_search.py, 324 settings, kopi's 4 markets): pick on A = 4H RSI14 40/60 sets direction for 2 4H candles, enter on 15m close through last swing (size 2), stop 2 ATR(15m), RR 3. A +73.9R, **B +43.3R (t 1.49); 0 of 40 shuffles beat B R, 1 of 40 beat B t.** 690 trades, 30.6% wins, +117.2R.
- **Neighbourhood** (structure_refine.py, 810 nearby settings): 79% positive for the year, avg ≈ +27R. On 12 shuffled histories: 3–74% positive (none reach 79%), avg −53R to +18R.
- Steadiest pick: RSI14 40/60, direction lasts 3 4H candles, swing 2, stop 2.5 ATR(15m), RR 2: 859 trades, 39.7% wins, A +96.6R, B +31.5R, every market up (V100 +27.9, V100s +41.1, V75 +37.2, V75s +21.8).

Caveats: the neighbourhood is centred on a setting chosen on real data (biases real upward); Deriv says Vix prices are random-number generated, so a real edge should not exist; only a forward test on new candles settles it.
