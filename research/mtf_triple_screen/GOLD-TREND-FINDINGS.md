# Trading-strategy research — full findings (2026-10-22)

A day of honest backtesting across several strategy families. One rule held throughout: a strategy
is only believed if it beats a random-walk control and survives data it was not fitted on. Almost
nothing did. The one thing that works is slow trend-following — and on gold specifically.

## The one strategy to use
**Gold (XAUUSD), 45-minute bars, EMA 20/100 trend cross, stop 2×ATR, exit on opposite cross,
0.5% risk per trade.**
- 3.7 years (HistData M1 → 45m), real compounding $10,000 account:
  **$10,000 → $12,185 (+22%, ≈ +5.4%/yr), worst drawdown −12%.**
- At 0.25% risk: $11,104 (+11%), worst drawdown −6% (gentler, less return).
- Realistic income: ~$40–55/month on $10k, but LUMPY — most months near zero, profit arrives in
  bursts when gold trends. Not a steady paycheck.
- Leans on gold's 2023–2026 bull run; a sideways/down gold regime would chop it up.

## Why 45m and not faster (the core lesson: frequency is the enemy)
Same gold strategy, compounded real account, by timeframe:

| TF | trades | paper R | $10k @1% (DD) | $10k @0.5% (DD) | $10k @0.25% (DD) |
|----|-------:|--------:|---------------|------------------|-------------------|
| 5m | 2,566 | −2.8 | $3,805 (−97%) 💀 | $7,726 | $9,330 (loss) |
| 15m | 819 | +7.5 | $8,067 (−66%) ❌ | $9,630 (loss) | $9,996 (breakeven) |
| 30m | 420 | +36.7 | $12,099 (−38%) | $11,472 | $10,832 |
| 45m | 254 | +44.3 | $14,197 (−23%) | **$12,185 (−12%)** ✅ | $11,104 (−6%) |

The more you trade, the more the spread eats the edge and the deeper the drawdown compounds.
**15m (and 5m) LOSE on a real compounding account even though 15m is "+7.5R" on paper** — the
−66% drawdown compounds the account down faster than the wins recover it. Paper R ≠ account dollars.

## What did NOT work (all tested, all rejected)
- **AlgoAlpha "S&R Ultra" Pine indicator** (ported to Python): rejection/sweep/breakout signals,
  18 markets, 15m+1h → 0/18 positive, pooled −13,605R, t=−103. Its INVERSE loses the same
  (−13,385R): no edge to reverse, cost + 2:1-geometry sink both directions. See
  `deriv_signal_app/research/output/sr_ultra/REPORT.md`.
- **APA price-action strategy** (dashboard engine, 3y HistData): −362R net across 8 markets, +40R
  gross (breakeven before costs). On 5 majors −$18,661 on $50k. Gold +$797 (+8%) but t=0.39 (luck),
  and buy-and-hold gold made +140% vs the strategy's +8% — trading gold BEAT itself by holding.
- **Multi-timeframe "triple screen"** (bias 4H/1H/30m + confirm 15m/10m/5m, all six aligned):
  pooled −3,967R, t=−37, 0/6 markets. Requiring six-way agreement buys the top.
  `strategy-desk/research/mtf_triple_screen/run_mtf.py`.
- **High-win-rate indicators**: RSI(2) mean reversion = 61% win rate but −17.8% net (small wins,
  big losses). RSI(14), Bollinger fade all lose. Win rate is a vanity metric; expectancy is what
  pays. Parameter sweep with 70/30 train/test: mean-reversion dies out-of-sample; only the trend
  (MA cross) stayed positive on unseen data — and only at slow settings.
  `deriv_signal_app/research/indicator_winrate.py`, `indicator_sweep.py`.

## What DID work (the only edge found)
- **Slow trend-following / time-series momentum** — the one family with 137 years of peer-reviewed
  out-of-sample evidence. 12-month TSM on a diversified 12-asset daily basket (25y, Yahoo):
  Sharpe 0.47, t=+2.67 net of costs — statistically real (everything above had t≈0). It did NOT
  beat buy-and-hold on return (both ~8.8% CAGR), but is nearly uncorrelated (0.16) and made +39%
  in 2008 when buy-and-hold lost −26%: its value is crisis protection, not raw return.
  `~/projects/tsm-test/run_tsm.py`.
- **Gold trend-following** standalone: Sharpe 0.40, t=+2.84, best single asset — the slow (daily)
  cousin of the 45m strategy above. Gold was the ONLY asset green in nearly every test.

## The honest bottom line
- No intraday signal, no indicator, no timeframe mix, no inversion beat noise after costs — except
  slow trend-following, and even that only pays ~5–9%/yr with deep drawdowns, leaning on gold.
- Real edge in these markets is modest, slow, and lumpy. Anything promising more is selling you a
  high win rate that loses money or a curve-fit that dies out-of-sample.
- If trading gold: **45m trend, 0.5% risk, expect ~5%/yr, survive a −12% drawdown.** That's it.

Reproduce: `proper_risk.py` (portfolio), the per-TF block in this folder, `tsm-test/run_tsm.py`,
and the `deriv_signal_app/research/` scripts named above.
