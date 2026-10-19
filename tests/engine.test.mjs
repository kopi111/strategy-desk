// Run: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const APA = loadCore();
const settings = APA.settings.defaults();
const instruments = APA.settings.instruments(settings);
const feed = new APA.DemoFeed(instruments);
const seconds = { entry: 300, structure: 3600, bias: 14400 };

async function candleSets(symbol) {
  return {
    entry: await feed.candles(symbol, 300, 8000),
    structure: await feed.candles(symbol, 3600, 1400),
    bias: await feed.candles(symbol, 14400, 360),
  };
}

function cutAt(sets, time) {
  const before = (list, tf) => list.filter((candle) => candle.time + tf <= time);
  return { entry: before(sets.entry, 300), structure: before(sets.structure, 3600), bias: before(sets.bias, 14400) };
}

const tradeKey = (trade) => `${trade.id}|${trade.entry}|${trade.initialStop}|${trade.target}`;

let passed = 0;
async function test(name, body) {
  await body();
  passed++;
  console.log(`ok   ${name}`);
}

await test('no look-ahead: trades opened before a cut are identical with or without later candles', async () => {
  for (const symbol of ['R_75', 'frxXAUUSD', 'frxUSDJPY']) {
    const sets = await candleSets(symbol);
    const instrument = APA.instruments.bySymbol(instruments, symbol);
    const full = APA.engine.run({ instrument, strategy: settings.strategy, candleSets: sets, timeframeSeconds: seconds });
    const cutTime = sets.entry[Math.floor(sets.entry.length * 0.7)].time;
    const partial = APA.engine.run({ instrument, strategy: settings.strategy, candleSets: cutAt(sets, cutTime), timeframeSeconds: seconds });
    const early = (trades) => trades.filter((trade) => trade.entryTime <= cutTime).map(tradeKey);
    assert.deepEqual(early(partial.trades), early(full.trades), `${symbol}: early trades changed when future candles were added`);
  }
});

await test('every trade has its stop and target on the correct side', async () => {
  const sets = await candleSets('R_75');
  const sim = APA.engine.run({ instrument: APA.instruments.bySymbol(instruments, 'R_75'), strategy: settings.strategy, candleSets: sets, timeframeSeconds: seconds });
  assert.ok(sim.trades.length > 0, 'expected some trades on demo data');
  for (const trade of sim.trades) {
    const buying = trade.direction === 'buy';
    assert.ok(buying ? trade.initialStop < trade.entry && trade.target > trade.entry : trade.initialStop > trade.entry && trade.target < trade.entry, trade.id);
    assert.ok(trade.rewardToRisk >= settings.strategy.minRewardToRisk, `${trade.id} below minimum R:R`);
  }
});

await test('one trade per zone', async () => {
  const sets = await candleSets('frxEURUSD');
  const sim = APA.engine.run({ instrument: APA.instruments.bySymbol(instruments, 'frxEURUSD'), strategy: settings.strategy, candleSets: sets, timeframeSeconds: seconds });
  const zoneIds = sim.trades.map((trade) => trade.zone.id);
  assert.equal(new Set(zoneIds).size, zoneIds.length);
});

await test('position size: EURUSD 1% of 10,000 with a 20-pip stop = 0.5 lots', async () => {
  const result = APA.positionSize.calculate({ instrument: APA.instruments.bySymbol(instruments, 'frxEURUSD'), direction: 'buy', balance: 10000, riskPercent: 1, entry: 1.1, stop: 1.098, target: 1.106 });
  assert.equal(result.lots, 0.5);
  assert.equal(Math.round(result.stopPips), 20);
  assert.equal(result.rewardToRisk.toFixed(1), '3.0');
});

await test('position size: USDJPY converts yen profit to USD', async () => {
  const result = APA.positionSize.calculate({ instrument: APA.instruments.bySymbol(instruments, 'frxUSDJPY'), direction: 'sell', balance: 10000, riskPercent: 1, entry: 150, stop: 150.3 });
  assert.ok(Math.abs(result.potentialLoss - 100) < 1, `loss ${result.potentialLoss}`);
});

await test('position size: wrong-side stop names the stop field', async () => {
  assert.throws(() => APA.positionSize.calculate({ instrument: APA.instruments.bySymbol(instruments, 'frxXAUUSD'), direction: 'buy', balance: 1000, riskPercent: 1, entry: 2400, stop: 2410 }),
    (error) => error.field === 'stop');
});

await test('CSV feed parses and resamples', async () => {
  const rows = ['time,open,high,low,close'];
  for (let index = 0; index < 48; index++) rows.push(`${1700000400 + index * 300},1,${1 + index / 100},0.9,${1 + index / 200}`);
  const csv = new APA.CsvFeed('test.csv', rows.join('\n'));
  assert.equal(csv.baseSeconds, 300);
  const hourly = await csv.candles('X', 3600, 10);
  assert.ok(hourly.length >= 4 && hourly.length <= 5);
  await assert.rejects(() => csv.candles('X', 60, 10));
});

await test('performance: profit factor and drawdown', async () => {
  const summary = APA.performance.summarize([{ time: 1, pnl: 300 }, { time: 2, pnl: -100 }, { time: 3, pnl: -100 }, { time: 4, pnl: 200 }], 1000);
  assert.equal(summary.profitFactor, 2.5);
  assert.equal(summary.maxDrawdown, 200);
  assert.equal(summary.winRate, 0.5);
});

console.log(`\n${passed} tests passed.`);
