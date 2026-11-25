# "Synthetic & Forex Hub" — APA signals, checked and backtested (2026-10-23)

Source: WhatsApp export `~/Downloads/Synthetic & Forex Hub💻📈.zip` (text only, 126 pictures omitted),
27 Jul – 23 Oct 2026. Admin trades Deriv synthetic indices (Vix 10/25/75/100, the 1s versions, Jump, Step,
Boom/Crash) with "APA — Advanced Price Action".

## The method, as he posted it (10 Aug)
1. 1H: find a re-balance (fair value gap); sell from premium, buy from discount.
2. 15M/30M: the re-balance is an order block being mitigated.
3. 5M: enter at the last unmitigated order block, "only on confirmation".
4. Direction from 24H/4H/1H/30M. SL at the block's high/low. TP mostly 1:2, sometimes 1:5 or "open".

## 1. His posted calls vs real Deriv 1-minute prices (`audit_signals.py`)
12 calls had prices in the text. Entry = his price if given, else the market price when posted.

| # | Date | Market | Call | Real outcome at 2R |
|---|------|--------|------|--------------------|
| 1 | 28 Jul | Vix 25 | buy limit 2706.5 → TP1 2717.6 | filled; TP1 only after 34 h and a 44-pt drop (his SL not stated) |
| 2 | 20 Aug | 25s | sell | stopped in 24 min (he admitted) |
| 3 | 4 Sep | 75s | sell | stopped after 5.7 h |
| 4 | 7 Sep | Vix 75 | sell | **won** (reached 3R) |
| 5 | 7 Sep | 30s | sell | stopped in 22 min (he claimed profit — his entry differed) |
| 6 | 8 Sep | 10s | sell | stopped (he claimed 1:2 from a later re-entry level) |
| 7 | 8 Sep | 75s | sell | 1R hit, then stopped |
| 8 | 14 Sep | Jump 25 | buy | stopped in 18 min (he admitted) |
| 9 | 18 Oct | Vix 10 | sell 4892.97 / SL 4897.33 / TP 4874.83 | stopped in 34 min |
| 10 | 19 Oct | 15s | buy 13208.49 | **won** (7.9R run) — he says he didn't take it |
| 11 | 23 Oct | 15s | sell, TP 13142.81 | stopped in 46 min |
| 12 | 23 Oct | 30s | sell | ran ~1R, then stopped |

At a 2R target: **2 wins, 9 losses of 11 scoreable → about −5R.** Caveat: most calls say "enter on
confirmation" with no entry price, so his real fills may differ.

## 2. The method as rules, 11 Deriv markets (`backtest_apa.py`)
Data: Deriv 1-minute candles 25 Jul – 23 Oct 2026 (Deriv only keeps ~90 days at 1 minute).
Setups found on 5M/1H/4H built from them; fills and exits on 1M. No look-ahead. No spread charged.

| Target | Trades | Win % | Break-even win % | Net R | t |
|--------|-------:|------:|-----------------:|------:|---:|
| 1R | 37 | 35% | 50% | −11 | −1.9 |
| 2R | 103 | 35% | 33% | +5 | 0.3 |
| 3R | 168 | 26% | 25% | +8 | 0.4 |
| 5R | 261 | 17% | 17% | −3 | −0.1 |

Luck control (`luck_control.py`, same rules on 5 random walks per market with the same volatility):
2R −0.20R/trade, 3R −0.08, 5R +0.02. The scoring is slightly harsh (same-minute stop counted first); the real
markets land within ~1.6 standard errors of the random walks — not significant.

## Verdict
No edge. Win rates sit on the break-even line for every target, before paying the spread. That is what
theory predicts: Deriv generates these indices from a random number generator, so past candles carry no
information about the next move. Order blocks, FVGs and "liquidity" are visible on random data too.

Things in the chat worth noticing: entries are mostly "SL in pic / TP open / enter on confirmation", which can
never be checked; losses are posted less than wins ("only lost 1 trade in 2 weeks" on 5 Aug, then losses on
31 Jul, 18 Aug Crash 900 "massive L", 20 Aug, 3 Sep, 16 Sep, 19 Oct); the group sells a paid VIP batch and
1-on-1 sessions; two weeks off in August for "withdrawal issues".
