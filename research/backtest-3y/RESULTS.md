# APA 3-year backtest — real prices (2023-10-01 → 2026-09-30)

Data: HistData.com 1-minute bid candles (EST, no DST → converted to UTC), built into 5m entry / 1H structure / 4H bias.
Engine: the dashboard's own `js/core/` with default settings, 1% risk, the dashboard's spreads. Re-run: `node research/backtest-3y/run.mjs`.
Deriv synthetics not included: Deriv returns HTTP 520 from this machine and the local cache only holds 1 year.

| Market | Trades | Win % | PF | Net R | Gross R (no costs) | Max DD |
|---|---|---|---|---|---|---|
| XAUUSD | 238 | 29.4 | 1.04 | +13.3 | +30.2 | 24.8% |
| GBPUSD | 295 | 26.8 | 0.93 | −8.8 | +34.9 | 38.6% |
| USDCAD | 255 | 28.2 | 0.82 | −30.0 | +16.0 | 37.4% |
| USDJPY | 278 | 24.8 | 0.80 | −38.5 | −6.5 | 45.8% |
| NZDUSD | 292 | 26.4 | 0.83 | −43.6 | +32.3 | 53.6% |
| AUDUSD | 320 | 25.9 | 0.78 | −57.8 | +12.1 | 54.9% |
| EURUSD | 295 | 24.7 | 0.69 | −77.3 | −20.8 | 64.0% |
| USDCHF | 292 | 23.3 | 0.57 | −119.2 | −58.1 | 75.9% |
| **All** | **2265** | **26.1** | **0.82** | **−361.9** | **+40.1** | |

By year (all markets): 2023 Q4 −20.9R · 2024 −138.6R · 2025 −109.9R · 2026 (to Sep) −92.5R.
Only entry model above zero: A-formation (+16.0R / 244 trades). Gold's +13.3R has t = 0.39 — indistinguishable from luck.
Verdict: no edge. Before costs it is roughly break-even (+40R over 2265 trades ≈ +0.02R/trade); spread costs ~0.18R a trade turn it into a steady loss.
