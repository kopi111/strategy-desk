// 3-year backtest of the dashboard's own engine on real HistData.com 1-minute prices.
// Run: node research/backtest-3y/run.mjs [SYMBOL ...]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../../tests/load-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const M1_DIR = join(HERE, 'm1');
const FROM = Date.UTC(2023, 9, 1) / 1000;
const TO = Date.UTC(2026, 9, 1) / 1000;
const HISTDATA_UTC_OFFSET_SECONDS = 5 * 3600; // HistData stamps are EST with no daylight saving
const SECONDS = { entry: 300, structure: 3600, bias: 14400 };
const RISK_PERCENT = 1;
const STARTING_BALANCE = 10000;

const APA = loadCore();
const settings = APA.settings.defaults();
const instruments = APA.settings.instruments(settings);

function parseHistDataTime(stamp) {
  const [date, time] = stamp.split(' ');
  const utc = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), +time.slice(0, 2), +time.slice(2, 4));
  return utc / 1000 + HISTDATA_UTC_OFFSET_SECONDS;
}

function readMinuteCandles(pair) {
  const files = readdirSync(M1_DIR).filter((name) => name.startsWith(`DAT_ASCII_${pair}_M1_`)).sort();
  const candles = [];
  for (const file of files) {
    for (const line of readFileSync(join(M1_DIR, file), 'utf8').split('\n')) {
      if (!line) continue;
      const [stamp, open, high, low, close] = line.split(';');
      const time = parseHistDataTime(stamp);
      if (time >= FROM && time < TO) candles.push({ time, open: +open, high: +high, low: +low, close: +close });
    }
  }
  return candles.sort((first, second) => first.time - second.time);
}

function aggregate(minutes, seconds) {
  const out = [];
  let current = null;
  for (const candle of minutes) {
    const bucket = candle.time - (candle.time % seconds);
    if (!current || current.time !== bucket) {
      current = { time: bucket, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
      out.push(current);
      continue;
    }
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
  }
  return out;
}

function summarizeTrades(trades) {
  const results = APA.performance.fromBacktestTrades(trades, STARTING_BALANCE, RISK_PERCENT);
  return APA.performance.summarize(results, STARTING_BALANCE);
}

function yearOf(trade) {
  return new Date(trade.entryTime * 1000).getUTCFullYear();
}

function backtest(symbol) {
  const instrument = APA.instruments.bySymbol(instruments, symbol);
  const minutes = readMinuteCandles(instrument.shortName);
  const candleSets = { entry: aggregate(minutes, SECONDS.entry), structure: aggregate(minutes, SECONDS.structure), bias: aggregate(minutes, SECONDS.bias) };
  const started = Date.now();
  const simulation = APA.engine.run({ instrument, strategy: settings.strategy, candleSets, timeframeSeconds: SECONDS });
  const closed = simulation.trades.filter((trade) => trade.status === 'closed');
  const byYear = {};
  for (const year of [...new Set(closed.map(yearOf))].sort()) byYear[year] = summarizeTrades(closed.filter((trade) => yearOf(trade) === year));
  const byModel = {};
  for (const model of [...new Set(closed.map((trade) => trade.model))]) byModel[model] = summarizeTrades(closed.filter((trade) => trade.model === model));
  return {
    symbol, market: instrument.shortName, spread: instrument.spread, entryCandles: candleSets.entry.length,
    firstCandle: new Date(candleSets.entry[0].time * 1000).toISOString(), lastCandle: new Date(candleSets.entry.at(-1).time * 1000).toISOString(),
    seconds: (Date.now() - started) / 1000, summary: summarizeTrades(closed), byYear, byModel,
    trades: closed.map(({ model, direction, entryTime, exitTime, entry, initialStop, target, grossR, netR, costR, exitReason }) =>
      ({ model, direction, entryTime, exitTime, entry, initialStop, target, grossR, netR, costR, exitReason })),
  };
}

const symbols = process.argv.slice(2).length ? process.argv.slice(2)
  : ['frxEURUSD', 'frxGBPUSD', 'frxAUDUSD', 'frxNZDUSD', 'frxUSDJPY', 'frxUSDCAD', 'frxUSDCHF', 'frxXAUUSD'];
for (const symbol of symbols) {
  const result = backtest(symbol);
  writeFileSync(join(HERE, 'results', `${result.market}.json`), JSON.stringify(result, null, 1));
  const s = result.summary;
  console.log(`${result.market.padEnd(7)} trades ${String(s.count).padStart(4)}  win ${(s.winRate * 100).toFixed(1)}%  PF ${s.profitFactor?.toFixed?.(2) ?? s.profitFactor}  totalR ${s.totalR?.toFixed(1)}  maxDD ${s.maxDrawdownPercent.toFixed(1)}%  (${result.seconds.toFixed(0)}s)`);
}
