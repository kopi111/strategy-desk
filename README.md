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

## Chart markup and alerts

The Chart page draws BOS, MSS, fair value gaps, order blocks and liquidity sweeps on live candles. Tick the other
concepts above the chart: IFVG, breaker block, OTE, supply and demand, support and resistance, breakout, CRT,
Silver Bullet and Power of 3. "KRM" is left out because no public source defines its rules.

The Alerts page checks the chosen markets every 30 seconds and gives a sound, a desktop pop-up and a log entry. Zone
touches fire while the candle is still forming; everything else fires when the candle closes. Alerts only run on live
Deriv prices, and only while this page is open. Setups already on the chart when the page opens stay quiet.

These definitions are in `js/core/smart-money.js`. None of them come from an official rulebook, and an alert is not
evidence that a trade will work. See `research/fvg-return/REPORT.md` for what testing found.

## Potential trades

The Chart page draws the buy or sell, stop and take profit for the market on screen, with a card showing the rule's
backtest result. "Hide trade" removes them. The Trades page lists every market, plus the gold trend rule.

A setup needs the 1H and 4H trends to agree, a 15-minute order block or FVG at or within one average candle of the
price, a sweep or MSS in the last 16 candles, and at least 1R of reward. The stop is half an average candle past the
zone and the take profit is the last 24 hours' high or low. The rule is in `js/core/potential-trade.js`.

`research/potential-trade/backtest.mjs` runs that same code through history. **The rule lost money after spread on all
11 markets tested**, with no clear gain over shuffled candles, so a potential trade is not a recommendation. Forex and
the other markets without a figure have not been tested. If the rule changes, run the backtest again and update
`js/core/potential-trade-backtest.js`.

Deriv's public `app_id` 1089 refuses live streaming, so the chart polls for the newest candle every 10 seconds. A
registered app id would use streaming automatically.

## Phone alerts (Telegram)

`alerts/telegram-watcher.mjs` runs the same alert rules without a browser, as a background service, and sends setups to
Telegram. It needs this computer switched on and online.

1. In Telegram, message `@BotFather`, send `/newbot` and copy the token.
2. In a terminal, run `node alerts/telegram-setup.mjs`, paste the token, then message your bot once.

The token goes in `~/.credentials/all-projects.env`, never in this project. Choose markets, timeframe and setups in
`alerts/telegram-alerts.json`; changes apply within 30 seconds. To test without sending, add `--dry-run` to the watcher.
Service commands: `systemctl --user status strategy-desk-telegram`, `journalctl --user -u strategy-desk-telegram`.

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
js/ui/        views: dashboard, chart, alerts, trades, calculator, checklist, journal, analytics, backtest, rules, settings
tests/        engine.test.mjs (Node), e2e.mjs (Playwright walk-through)
```

## Trained model

The dashboard also shows a machine-learning model trained on 10 years of hourly prices, with how it tested.
Training, results and the parity check are in [`ml/README.md`](ml/README.md).

## Tests

```bash
node tests/engine.test.mjs                       # includes a no-look-ahead check
node tests/smart-money.test.mjs                  # markup detectors, alert watcher, no-look-ahead
node tests/telegram.test.mjs                     # phone alerts, with a fake Telegram
node tests/potential-trade.test.mjs              # potential trade levels and backtest wording
python3 -m http.server 8765 & node tests/e2e.mjs # clicks every view; fails on console errors or sideways scroll
```

This is a research and education tool, not financial advice. Run the Backtest on each market before trusting any model.
