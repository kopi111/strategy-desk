// Backtests the exact rule the Desk shows as a "potential trade", by calling the Desk's own code at every closed 15-minute candle.
// Run: node research/potential-trade/backtest.mjs <symbol> [shuffled]
// Each market writes its own JSON file to results/. Nothing was tuned on these prices: the rule was fixed before this first run.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../../tests/load-core.mjs';
import { randomSource, readCandles, shuffledCandles, SPREAD_SHARE, summarize } from '../fvg-return/study.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APA = loadCore();
const { planFrom, CANDLES_NEEDED, ENTRY_SECONDS, HOUR_SECONDS, FOUR_HOUR_SECONDS } = APA.potentialTrade;
const GOLD = 'frxXAUUSD';
const GOLD_SPREAD_SHARE = 0.3 / 3000;
const GOLD_MINUTES_FOLDER = join(HERE, '..', 'backtest-3y', 'm1');
const HISTDATA_UTC_OFFSET_SECONDS = 5 * 3600;
const SHUFFLE_SEED = 7;

/** Reads the monthly 1-minute gold files, in time order, and joins them into 15-minute candles. */
function readGold() {
  const minutes = [];
  for (const name of readdirSync(GOLD_MINUTES_FOLDER).filter((file) => file.includes('XAUUSD')).sort()) {
    for (const line of readFileSync(join(GOLD_MINUTES_FOLDER, name), 'utf8').trim().split('\n')) {
      const [stamp, open, high, low, close] = line.split(';');
      const time = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13)) / 1000 + HISTDATA_UTC_OFFSET_SECONDS;
      minutes.push({ time, open: +open, high: +high, low: +low, close: +close });
    }
  }
  return APA.candles.resample(minutes, ENTRY_SECONDS);
}

/** Returns a function giving a higher timeframe's trend at any moment, using only candles already closed then. */
function trendReader(candles, seconds, window) {
  const higher = APA.candles.resample(candles, seconds);
  let cachedIndex = -2;
  let cachedTrend = 'none';
  return (closeTime) => {
    const index = APA.candles.lastIndexAtOrBefore(higher, closeTime - seconds);
    if (index !== cachedIndex) {
      cachedIndex = index;
      cachedTrend = index < 0 ? 'none' : APA.smartMoney.analyze(higher.slice(Math.max(0, index - window + 1), index + 1), { timeframeSeconds: seconds }).trend;
    }
    return cachedTrend;
  };
}

/** The price the trade really starts at on the next candle, or NaN if it did not fill. A waiting plan gets one candle to fill. */
function fillPrice(plan, candle) {
  if (plan.status === 'ready') return candle.open;
  if (plan.side === 'buy') return candle.low <= plan.entry ? Math.min(candle.open, plan.entry) : NaN;
  return candle.high >= plan.entry ? Math.max(candle.open, plan.entry) : NaN;
}

/** Follows a filled trade to its stop or target. If one candle touches both, the stop counts, which is the cautious answer. */
function exitOf(plan, candles, fillIndex) {
  const buying = plan.side === 'buy';
  for (let index = fillIndex; index < candles.length; index++) {
    const candle = candles[index];
    const stopped = buying ? candle.low <= plan.stop : candle.high >= plan.stop;
    if (stopped) {
      const gappedPast = index > fillIndex && (buying ? candle.open < plan.stop : candle.open > plan.stop);
      return { exit: gappedPast ? candle.open : plan.stop, index };
    }
    if (buying ? candle.high >= plan.target : candle.low <= plan.target) return { exit: plan.target, index };
  }
  return { exit: NaN, index: candles.length };
}

/** Works out a finished trade's result in R, before and after spread. */
function resultOf(plan, entry, exit, spreadShare) {
  const risk = Math.abs(entry - plan.stop);
  const grossR = (plan.side === 'buy' ? exit - entry : entry - exit) / risk;
  const reward = Math.abs(plan.target - entry);
  return { grossR, netR: grossR - (entry * spreadShare) / risk, side: plan.side, breakEven: risk / (risk + reward) };
}

/** Is this fill still a sensible trade? The next candle can open past the stop or target. */
function isValidFill(plan, entry) {
  return plan.side === 'buy' ? entry > plan.stop && entry < plan.target : entry < plan.stop && entry > plan.target;
}

/** Walks through history one closed candle at a time, one trade at a time. */
function run(candles, spreadShare) {
  const hourTrend = trendReader(candles, HOUR_SECONDS, CANDLES_NEEDED.hour);
  const fourHourTrend = trendReader(candles, FOUR_HOUR_SECONDS, CANDLES_NEEDED.fourHour);
  const trades = [];
  const window = CANDLES_NEEDED.entry;
  for (let index = window - 1; index < candles.length - 1; index++) {
    const closeTime = candles[index].time + ENTRY_SECONDS;
    const hour = hourTrend(closeTime);
    const fourHour = fourHourTrend(closeTime);
    if (APA.potentialTrade.sideFromTrends(hour, fourHour) === 'none') continue;
    const analysis = APA.smartMoney.analyze(candles.slice(index - window + 1, index + 1), { timeframeSeconds: ENTRY_SECONDS });
    const plan = planFrom(analysis, hour, fourHour, candles[index].close);
    if (plan.status === 'none') continue;
    const entry = fillPrice(plan, candles[index + 1]);
    if (!isValidFill(plan, entry)) continue;
    const { exit, index: exitIndex } = exitOf(plan, candles, index + 1);
    if (Number.isNaN(exit)) break;
    trades.push({ ...resultOf(plan, entry, exit, spreadShare), time: candles[index + 1].time });
    index = exitIndex;
  }
  return trades;
}

const [symbol, mode] = process.argv.slice(2);
const real = symbol === GOLD ? readGold() : readCandles(symbol, '15m');
const candles = mode === 'shuffled' ? shuffledCandles(real, randomSource(SHUFFLE_SEED)) : real;
const trades = run(candles, symbol === GOLD ? GOLD_SPREAD_SHARE : SPREAD_SHARE[symbol]);
const summary = summarize(trades.map((trade) => trade.netR));
const wins = trades.filter((trade) => trade.grossR > 0).length;
const average = (pick) => trades.reduce((sum, trade) => sum + pick(trade), 0) / Math.max(1, trades.length);
const half = Math.floor(trades.length / 2);
const meanOf = (list) => list.reduce((sum, trade) => sum + trade.netR, 0) / Math.max(1, list.length);
const result = {
  symbol, mode: mode || 'real', from: new Date(candles[0].time * 1000).toISOString().slice(0, 10), to: new Date(candles.at(-1).time * 1000).toISOString().slice(0, 10),
  trades: trades.length, winRate: wins / Math.max(1, trades.length), breakEven: average((trade) => trade.breakEven),
  grossR: average((trade) => trade.grossR), netR: average((trade) => trade.netR), t: summary.t,
  totalR: trades.reduce((sum, trade) => sum + trade.netR, 0), firstHalfR: meanOf(trades.slice(0, half)), lastHalfR: meanOf(trades.slice(half)),
};
mkdirSync(join(HERE, 'results'), { recursive: true });
writeFileSync(join(HERE, 'results', `${symbol}-${result.mode}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
