// Run: node tests/potential-trade.test.mjs
// Checks the potential trade rule on hand-built analyses, where the right levels are known, and the backtest wording.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const APA = loadCore();
const { planFrom, sideFromTrends, goldTrendState } = APA.potentialTrade;
const FIFTEEN_MINUTES = 900;
const flatCandles = Array.from({ length: 100 }, (_, index) => ({ time: index * FIFTEEN_MINUTES, open: 100, high: 101, low: 99, close: 100 }));
const lastTime = flatCandles.at(-1).time;
const sellZone = { concept: 'fvg', direction: 'sell', endIndex: null, bottom: 100, top: 100.5 };
const sellSweep = { concept: 'sweep', direction: 'sell', time: lastTime };
const analysisWith = (zones, events, candles = flatCandles) => ({ candles, zones, events });

// Runs one named test and prints the result.
function test(name, body) {
  body();
  console.log(`ok   ${name}`);
}

test('a side needs the 1H and 4H trends to agree', () => {
  assert.equal(sideFromTrends('up', 'up'), 'buy');
  assert.equal(sideFromTrends('down', 'down'), 'sell');
  assert.equal(sideFromTrends('up', 'down'), 'none');
  assert.equal(sideFromTrends('none', 'none'), 'none');
});

test('a sell inside the zone is ready, with the stop past the zone and the TP at the day low', () => {
  const lowerCandles = flatCandles.map((candle, index) => (index === 90 ? { ...candle, low: 95 } : candle));
  const plan = planFrom(analysisWith([sellZone], [sellSweep], lowerCandles), 'down', 'down', 100.2);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.side, 'sell');
  assert.equal(plan.entry, 100.2);
  assert.ok(Math.abs(plan.stop - 101.5) < 0.2, `stop was ${plan.stop}`);
  assert.equal(plan.target, 95);
  assert.ok(plan.rewardToRisk > 1);
});

test('a price just below a sell zone waits for the pullback', () => {
  const lowerCandles = flatCandles.map((candle, index) => (index === 90 ? { ...candle, low: 90 } : candle));
  const plan = planFrom(analysisWith([sellZone], [sellSweep], lowerCandles), 'down', 'down', 99.5);
  assert.equal(plan.status, 'waiting');
  assert.equal(plan.entry, 100);
});

test('no trade without a zone, a recent confirmation, or enough reward', () => {
  assert.equal(planFrom(analysisWith([], [sellSweep]), 'down', 'down', 100).status, 'none');
  assert.equal(planFrom(analysisWith([sellZone], []), 'down', 'down', 100.2).status, 'none');
  const oldSweep = { ...sellSweep, time: lastTime - 17 * FIFTEEN_MINUTES };
  assert.equal(planFrom(analysisWith([sellZone], [oldSweep]), 'down', 'down', 100.2).status, 'none');
  assert.equal(planFrom(analysisWith([sellZone], [sellSweep]), 'down', 'down', 100.2).status, 'none');
});

test('a zone that has already ended is ignored', () => {
  const ended = { ...sellZone, endIndex: 50 };
  assert.equal(planFrom(analysisWith([ended], [sellSweep]), 'down', 'down', 100.2).status, 'none');
});

test('the gold trend rule follows the averages, and reports a stop that was hit', () => {
  const candle = (index, price) => ({ time: index * FIFTEEN_MINUTES, open: price, high: price + 1, low: price - 1, close: price });
  const falling = Array.from({ length: 600 }, (_, index) => candle(index, 2000 - index * 0.5));
  const rising = Array.from({ length: 600 }, (_, index) => candle(600 + index, 1700 + index * 0.5));
  const state = goldTrendState([...falling, ...rising]);
  assert.equal(state.side, 'buy');
  assert.equal(state.status, 'open');
  assert.ok(state.stop < state.entry);
  const drop = Array.from({ length: 3 }, (_, index) => candle(1200 + index, 1500));
  assert.equal(goldTrendState([...falling, ...rising, ...drop]).status, 'stopped');
});

test('the pages never call a losing or untested market proven', () => {
  assert.match(APA.potentialTradeBacktest.describe('frxXAUUSD').text, /lost money/);
  assert.match(APA.potentialTradeBacktest.describe('frxEURUSD').text, /not tested/);
  assert.match(APA.potentialTradeBacktest.describe('1HZ90V').text, /no proven edge/);
});

test('every Volatility index on the Desk has a backtest figure', () => {
  const vix = APA.instruments.defaults.filter((instrument) => instrument.name.startsWith('Volatility'));
  assert.equal(vix.length, 18);
  for (const instrument of vix) assert.doesNotMatch(APA.potentialTradeBacktest.describe(instrument.symbol).text, /not tested/, instrument.symbol);
});

console.log('All potential trade tests passed.');
