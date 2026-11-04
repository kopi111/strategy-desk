# Trained model (machine learning)

A gradient-boosted tree model (scikit-learn `HistGradientBoostingClassifier`) trained on hourly candles.

**Question it answers:** from the latest closed hourly candle, does price move 1 ATR up before it moves 1 ATR down
within 24 candles?

- **Real markets model:** XAUUSD, EURUSD, GBPUSD, AUDUSD, USDJPY, USDCAD (2016–2026), plus NZDUSD and USDCHF (about 1 year).
- **Synthetics model:** Volatility 10–100, 1s indices and Step Index (about 1 year). These are random by design, so this
  model is a control: if it ever "finds" an edge, the testing is broken.
- **Features (19):** returns over 1/4/12/24/72 candles, volatility regime, RSI, distance to 24/120-candle highs and lows,
  distance to the 20/50/200 SMAs, last candle body and wicks, hour and weekday. Everything is scaled by ATR so markets
  can share one model.
- **Testing:** walk-forward by year. Each year from 2019 is predicted by a model trained only on earlier years. Trades
  pay the spread from `js/core/instruments.js`, and only one position per market is open at a time.

## Result (trained 2026-10-19)

| | Real markets | Synthetics |
|---|---|---|
| AUC (0.5 = coin flip) | 0.518 | 0.501 |
| Accuracy | 51.4% | 49.7% |
| Test trades | 1,251 | 122 |
| Net after spread | +34.8R (t = 0.99) | +9.9R (t = 0.90) |

AUC was above 0.5 in every test year (0.509–0.529), so the model does pick up something real, but it is too small to
pay for the spread reliably. One year lost (2023: −15.5R). XAUUSD alone was +30R (t = 2.3), but with 8 markets tested,
one of them looking that good is expected by chance. **Verdict: no tradable edge. Use the reading as context.**

## Run

```bash
cd ~/projects/strategy-desk
uv venv ml/.venv && VIRTUAL_ENV=ml/.venv uv pip install numpy pandas scikit-learn   # first time only
ml/.venv/bin/python ml/train_trading.py                                             # ~2 min; writes ml/output/
ml/.venv/bin/python ml/export_parity.py && node ml/check_parity.mjs                 # browser model == Python
```

Candle data comes from `~/projects/deriv_signal_app/research/cache/` (hourly CSVs).

The dashboard loads `ml/output/model.json` and runs the trees in the browser (`js/core/ml-model.js`) on the newest
closed hourly candles from whichever data source is active. If you change a feature in `ml/trading_features.py`,
change `features()` in `js/core/ml-model.js` the same way and re-run the parity check.
