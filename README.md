# APA Strategy Desk

A trading dashboard built on the **APA (Advanced Price Action)** strategy from two videos:

- V1: [A.P.A Trading Strategy Full Course](https://www.youtube.com/watch?v=jLRm2poYbec&t=1051s) by Mr Leo Fx
- V2: [A.P.A Live Class Explaining The Full Strategy](https://www.youtube.com/watch?v=OiEj6AQIris&t=507s) by Tradebyladen

The rules taken from them, with timestamps, are in [`docs/STRATEGY-RULES.md`](docs/STRATEGY-RULES.md). The transcripts
are in `research/`.

**Markets:** Deriv synthetic indices (Volatility 10–100, 1s indices, Boom/Crash, Step), XAUUSD, and USD pairs
(EURUSD, GBPUSD, AUDUSD, NZDUSD, USDJPY, USDCAD, USDCHF, USD Basket).

Plain HTML, CSS and JavaScript. No build step, no backend, no framework.

## Run it

```bash
cd ~/projects/strategy-desk
python3 -m http.server 8765
# open http://127.0.0.1:8765
```

Opening `index.html` directly also works. An internet connection is needed for the chart library (unpkg) and live
data.

## Data source

Settings → Data source:

| Source | What it does |
|---|---|
| `auto` (default) | Deriv's public WebSocket API. If Deriv can't be reached, falls back to **demo** data and says so on every screen |
| `deriv` | Deriv only; shows an error if it is down |
| `demo` | Generated candles (seeded random walk). Clearly labelled; not prices |
| `csv` | Your own OHLC file (`time,open,high,low,close`). Load the entry timeframe; higher timeframes are built from it |

Deriv needs no API key (`app_id` 1089 is Deriv's public id). Never put a private key in this app: browser code can be
read by anyone. To add another provider, write a class with `connect()`, `candles(symbol, seconds, count)` and
`subscribe(symbol, seconds, onCandle)` like `js/data/deriv-feed.js`, and pick it in `MarketData.connect()`.

Signals use **closed candles only**. The live stream only redraws the chart and triggers a re-run when a candle closes.

## Layout

```
js/core/      strategy engine, independent of the page (also runs in Node)
  structure.js   swings on candle bodies, BOS / change of character
  zones.js       the 8 entry models → zones
  engine.js      replays tap → liquidity → confirmation → trade on the entry timeframe
  signal.js      BUY / SELL / WAIT / NO TRADE, checklist, proposed plan
  performance.js win rate, profit factor, drawdown, equity
  position-size.js
js/data/      Deriv, demo and CSV feeds
js/ui/        views: dashboard, chart, calculator, checklist, journal, analytics, backtest, rules, settings
tests/        engine.test.mjs (Node), e2e.mjs (Playwright walk-through)
```

## Tests

```bash
node tests/engine.test.mjs                       # includes a no-look-ahead check
python3 -m http.server 8765 & node tests/e2e.mjs # clicks every view; fails on console errors or sideways scroll
```

This is a research and education tool, not financial advice. Run the Backtest on each market before trusting any model.
