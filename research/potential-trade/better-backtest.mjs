// A stricter test of the Desk's "potential trade" rule on one market.
// Improves on backtest.mjs in three ways:
//   1. Stops and targets are followed on 5m candles, so a 15m candle touching both no longer counts as a loss by default.
//   2. Results are shown at several spread sizes, because most Volatility spreads in the Desk are assumed, not measured.
//   3. Results are split by time, direction and stop size, and compared with shuffled price histories.
//
// Run: node better-backtest.mjs 1HZ25V real
//      node better-backtest.mjs 1HZ25V shuffled 1     (one shuffled history; seed 1)
//      node better-backtest.mjs 1HZ25V report         (compares everything saved so far)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../../tests/load-core.mjs';
import { randomSource, readCandles, shuffledCandles, SPREAD_SHARE, summarize } from '../fvg-return/study.mjs';
import { exitOf, run } from './backtest.mjs';

const APA = loadCore();
const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, 'better-results');
const FIFTEEN_MINUTES = 900;
const CANDLES_INSIDE_FIFTEEN_MINUTES = 3;
const SPLIT_TIME = Date.UTC(2026, 6, 1) / 1000;
const SPREAD_LEVELS = [0, 0.25, 0.5, 0.75, 1];
const HIGH_REWARD = 5;

/** Finds the first candle at or after the given time, using a binary search. */
function firstIndexAtOrAfter(candles, time) {
  let low = 0;
  let high = candles.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (candles[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** For a limit order, finds the 5m candle that really filled it. A market order fills on the first candle. */
function fillingCandle(plan, fiveMinutes, start) {
  if (plan.status === 'ready') return start;
  for (let index = start; index < start + CANDLES_INSIDE_FIFTEEN_MINUTES && index < fiveMinutes.length; index++) {
    const touched = plan.side === 'buy' ? fiveMinutes[index].low <= plan.entry : fiveMinutes[index].high >= plan.entry;
    if (touched) return index;
  }
  return start;
}

/** Builds an exit finder that follows the trade on 5m candles but tells the 15m loop where it ended. */
function fiveMinuteExits(fiveMinutes, fifteenMinutes) {
  return (plan, _candles, fillIndex) => {
    const start = firstIndexAtOrAfter(fiveMinutes, fifteenMinutes[fillIndex].time);
    const { exit, index } = exitOf(plan, fiveMinutes, fillingCandle(plan, fiveMinutes, start));
    if (Number.isNaN(exit)) return { exit, index: fifteenMinutes.length };
    // The 15m loop continues from the 15m candle that contains the 5m exit.
    const after = firstIndexAtOrAfter(fifteenMinutes, fiveMinutes[index].time + 1);
    return { exit, index: Math.max(fillIndex, after - 1) };
  };
}

/** Runs the Desk's rule over 5m history and returns its trades with 5m exits. */
function tradesFrom(fiveMinutes, spreadShare) {
  const fifteenMinutes = APA.candles.resample(fiveMinutes, FIFTEEN_MINUTES);
  return run(fifteenMinutes, spreadShare, fiveMinuteExits(fiveMinutes, fifteenMinutes));
}

/** A trade's result after paying the given fraction of the Desk's assumed spread. */
function netResult(trade, spreadShare, spreadLevel) {
  return trade.grossR - (trade.entry * spreadShare * spreadLevel) / trade.risk;
}

/** How many spreads fit inside this trade's stop. */
function stopInSpreads(trade, spreadShare) {
  return trade.risk / (trade.entry * spreadShare);
}

/** Summarises a group of trades, before spread and at each spread level. */
function describe(trades, spreadShare) {
  const before = summarize(trades.map((trade) => trade.grossR));
  const atLevels = Object.fromEntries(SPREAD_LEVELS.map((level) => [level, summarize(trades.map((trade) => netResult(trade, spreadShare, level)))]));
  return {
    trades: trades.length, winRate: before.win, breakEven: trades.reduce((sum, trade) => sum + trade.breakEven, 0) / Math.max(1, trades.length),
    grossAverage: before.mean, grossT: before.t,
    netAverage: Object.fromEntries(SPREAD_LEVELS.map((level) => [level, atLevels[level].mean])), netTotalFull: atLevels[1].mean * trades.length, netTFull: atLevels[1].t,
  };
}

/** The groups the report compares, including the group today's Volatility 25 (1s) sell belongs to. */
function groupsOf(trades, spreadShare) {
  const stop = (trade) => stopInSpreads(trade, spreadShare);
  const tests = {
    'all trades': () => true,
    'Nov-Jun': (trade) => trade.time < SPLIT_TIME,
    'Jul-Nov': (trade) => trade.time >= SPLIT_TIME,
    buys: (trade) => trade.side === 'buy',
    sells: (trade) => trade.side === 'sell',
    'stop under 3 spreads': (trade) => stop(trade) < 3,
    'stop 3-6 spreads': (trade) => stop(trade) >= 3 && stop(trade) < 6,
    'stop 6+ spreads': (trade) => stop(trade) >= 6,
    'stop 6+ spreads, Nov-Jun': (trade) => stop(trade) >= 6 && trade.time < SPLIT_TIME,
    'stop 6+ spreads, Jul-Nov': (trade) => stop(trade) >= 6 && trade.time >= SPLIT_TIME,
    'target 5R or more': (trade) => trade.rewardToRisk >= HIGH_REWARD,
    'like today: sell, 5R+, stop under 3 spreads': (trade) => trade.side === 'sell' && trade.rewardToRisk >= HIGH_REWARD && stop(trade) < 3,
  };
  return Object.fromEntries(Object.entries(tests).map(([name, test]) => [name, describe(trades.filter(test), spreadShare)]));
}

/** Tests one history (real, or shuffled from a seed) and saves its groups. */
function testHistory(symbol, seed) {
  const real = readCandles(symbol, '5m');
  const history = seed === null ? real : shuffledCandles(real, randomSource(seed));
  const groups = groupsOf(tradesFrom(history, SPREAD_SHARE[symbol]), SPREAD_SHARE[symbol]);
  mkdirSync(OUTPUT, { recursive: true });
  const name = seed === null ? 'real' : `shuffled-${seed}`;
  writeFileSync(join(OUTPUT, `${symbol}-${name}.json`), JSON.stringify(groups));
  console.log(name, JSON.stringify(groups['all trades']));
}

/** Reads every saved shuffled history for this market. */
function readShuffled(symbol) {
  return readdirSync(OUTPUT).filter((file) => file.startsWith(`${symbol}-shuffled-`))
    .map((file) => JSON.parse(readFileSync(join(OUTPUT, file), 'utf8')));
}

/** The middle value of a list of numbers. */
function medianOf(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Prints the real result of every group beside what shuffled candles did. */
function report(symbol) {
  const real = JSON.parse(readFileSync(join(OUTPUT, `${symbol}-real.json`), 'utf8'));
  const shuffled = readShuffled(symbol);
  const round = (value) => (Number.isFinite(value) ? value.toFixed(3) : 'n/a');
  console.log(`${shuffled.length} shuffled histories`);
  console.log('group | trades | win % | need % | gross R/trade | gross t | net at 0.25 / 0.5 / 0.75 / full spread | net total (full) | shuffled median gross | shuffled at or above real');
  for (const [name, group] of Object.entries(real)) {
    const others = shuffled.map((history) => history[name].grossAverage).filter(Number.isFinite);
    const atOrAbove = others.filter((value) => value >= group.grossAverage).length;
    console.log([name, group.trades, (group.winRate * 100).toFixed(1), (group.breakEven * 100).toFixed(1), round(group.grossAverage), round(group.grossT),
      [0.25, 0.5, 0.75, 1].map((level) => round(group.netAverage[level])).join(' / '), group.netTotalFull.toFixed(1), round(medianOf(others)), `${atOrAbove} of ${others.length}`].join(' | '));
  }
}

const [symbol, mode, seed] = process.argv.slice(2);
if (mode === 'report') report(symbol);
else testHistory(symbol, mode === 'shuffled' ? Number(seed) : null);
