// Runs the dashboard's engine on the latest candles for one market.
// Every market comes from Deriv (red.derivws.com); forex and gold fall back to Yahoo Finance if Deriv fails.
import { loadCore } from '../tests/load-core.mjs';

const MARKETS = {
  frxEURUSD: 'EURUSD=X', frxGBPUSD: 'GBPUSD=X', frxAUDUSD: 'AUDUSD=X', frxNZDUSD: 'NZDUSD=X',
  frxUSDJPY: 'JPY=X', frxUSDCAD: 'CAD=X', frxUSDCHF: 'CHF=X', frxXAUUSD: 'GC=F',
};
const SYNTHETICS = ['R_25', 'R_75', 'R_100', 'stpRNG2'];
const DERIV_ENDPOINT = 'wss://red.derivws.com/websockets/v3?app_id=1089';
const SECONDS = { entry: 300, structure: 3600, bias: 14400 };
const DERIV_COUNTS = { 300: 5000, 3600: 5000, 14400: 2000 };

const APA = loadCore();
const settings = APA.settings.defaults();
const instruments = APA.settings.instruments(settings);

async function yahooCandles(ticker, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Yahoo ${ticker} ${interval}: HTTP ${response.status}`);
  const [result] = (await response.json()).chart.result;
  const quote = result.indicators.quote[0];
  return result.timestamp
    .map((time, index) => ({ time, open: quote.open[index], high: quote.high[index], low: quote.low[index], close: quote.close[index] }))
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite));
}

function derivCandles(symbol, granularity) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(DERIV_ENDPOINT);
    const timer = setTimeout(() => { socket.close(); reject(new Error(`Deriv ${symbol}: no answer`)); }, 30000);
    socket.onopen = () => socket.send(JSON.stringify({ ticks_history: symbol, style: 'candles', granularity, count: DERIV_COUNTS[granularity], end: 'latest' }));
    socket.onerror = () => { clearTimeout(timer); reject(new Error(`Cannot reach ${DERIV_ENDPOINT}`)); };
    socket.onmessage = (message) => {
      clearTimeout(timer);
      socket.close();
      const data = JSON.parse(message.data);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.candles.map(({ epoch, open, high, low, close }) => ({ time: epoch, open: +open, high: +high, low: +low, close: +close })));
    };
  });
}

async function derivCandleSets(symbol) {
  const [entry, structure, bias] = await Promise.all(Object.values(SECONDS).map((seconds) => derivCandles(symbol, seconds)));
  return { entry: closed(entry, SECONDS.entry), structure: closed(structure, SECONDS.structure), bias: closed(bias, SECONDS.bias) };
}

async function yahooCandleSets(symbol) {
  const [fiveMinute, hourly] = await Promise.all([yahooCandles(MARKETS[symbol], '5m', '60d'), yahooCandles(MARKETS[symbol], '60m', '730d')]);
  return {
    entry: closed(aggregate(fiveMinute, SECONDS.entry), SECONDS.entry),
    structure: closed(aggregate(hourly, SECONDS.structure), SECONDS.structure),
    bias: closed(aggregate(hourly, SECONDS.bias), SECONDS.bias),
  };
}

function aggregate(candles, seconds) {
  const out = [];
  for (const candle of candles) {
    const bucket = candle.time - (candle.time % seconds);
    const current = out.at(-1);
    if (current?.time === bucket) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    } else out.push({ ...candle, time: bucket });
  }
  return out;
}

function closed(candles, seconds) {
  return APA.candles.closedOnly(candles, seconds, Math.floor(Date.now() / 1000));
}

export async function scan(symbol) {
  const instrument = APA.instruments.bySymbol(instruments, symbol);
  const { candleSets, source } = await candleSetsFor(symbol);
  const simulation = APA.engine.run({ instrument, strategy: settings.strategy, candleSets, timeframeSeconds: SECONDS });
  return { instrument, signal: APA.signal.describe(simulation), lastCandle: candleSets.entry.at(-1).time, source };
}

async function candleSetsFor(symbol) {
  try {
    return { candleSets: await derivCandleSets(symbol), source: 'Deriv' };
  } catch (error) {
    if (!MARKETS[symbol]) throw error;
    return { candleSets: await yahooCandleSets(symbol), source: `Yahoo (Deriv failed: ${error.message})` };
  }
}

export const ALL_SYMBOLS = [...SYNTHETICS, ...Object.keys(MARKETS)];

export function formatPrice(instrument, value) {
  return value == null ? '—' : APA.instruments.formatPrice(instrument, value);
}
