// Runs the dashboard's engine on the latest Yahoo Finance candles and prints the signal for each market.
// Used while Deriv's WebSocket is unreachable. Run: node research/live-scan.mjs
import { loadCore } from '../tests/load-core.mjs';

const MARKETS = {
  frxEURUSD: 'EURUSD=X', frxGBPUSD: 'GBPUSD=X', frxAUDUSD: 'AUDUSD=X', frxNZDUSD: 'NZDUSD=X',
  frxUSDJPY: 'JPY=X', frxUSDCAD: 'CAD=X', frxUSDCHF: 'CHF=X', frxXAUUSD: 'GC=F',
};
const SECONDS = { entry: 300, structure: 3600, bias: 14400 };

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

async function scan(symbol) {
  const instrument = APA.instruments.bySymbol(instruments, symbol);
  const [fiveMinute, hourly] = await Promise.all([yahooCandles(MARKETS[symbol], '5m', '60d'), yahooCandles(MARKETS[symbol], '60m', '730d')]);
  const candleSets = {
    entry: closed(aggregate(fiveMinute, SECONDS.entry), SECONDS.entry),
    structure: closed(aggregate(hourly, SECONDS.structure), SECONDS.structure),
    bias: closed(aggregate(hourly, SECONDS.bias), SECONDS.bias),
  };
  const simulation = APA.engine.run({ instrument, strategy: settings.strategy, candleSets, timeframeSeconds: SECONDS });
  return { instrument, signal: APA.signal.describe(simulation), lastCandle: candleSets.entry.at(-1).time };
}

for (const symbol of Object.keys(MARKETS)) {
  try {
    const { instrument, signal, lastCandle } = await scan(symbol);
    const price = (value) => (value == null ? '—' : APA.instruments.formatPrice(instrument, value));
    const plan = signal.plan;
    console.log(`\n== ${instrument.shortName}  ${signal.status}  close ${price(signal.lastClose)}  (last 5m ${new Date(lastCandle * 1000).toISOString().slice(0, 16)}Z)  4H ${signal.biasTrend} · 1H ${signal.structureTrend}`);
    console.log(`   ${signal.headline}`);
    if (signal.focus) console.log(`   zone: ${signal.focus.zone.model} ${signal.focus.zone.direction} @ ${price(signal.focus.zone.level)} [${signal.focus.status}] ${signal.focus.reason ?? ''}`);
    if (plan) console.log(`   plan (${plan.kind}): entry ${price(plan.entry)} stop ${price(plan.initialStop ?? plan.stop)} target ${price(plan.target)} RR ${plan.rewardToRisk?.toFixed?.(1) ?? '—'} ${plan.valid === false ? '(NOT VALID: ' + (plan.reason ?? '') + ')' : ''}`);
    for (const check of signal.checklist) console.log(`     [${check.result}] ${check.label}${check.detail ? ' — ' + check.detail : ''}`);
  } catch (error) {
    console.log(`\n== ${symbol}  ERROR ${error.message}`);
  }
}
