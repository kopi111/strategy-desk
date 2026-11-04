// Run: node tests/smart-money.test.mjs
// Checks each detector on hand-built candles where the right answer is known, then checks for look-ahead on long data.
import assert from 'node:assert/strict';
import { loadCore, loadScripts } from './load-core.mjs';

const APA = loadCore();
const HOUR = 3600;
const START = 1700000000 - (1700000000 % HOUR);
let passed = 0;

// Runs one named test and prints the result.
async function test(name, body) {
  await body();
  passed++;
  console.log(`ok   ${name}`);
}

// Builds candles from [open, high, low, close] rows, one hour apart.
function fromRows(rows) {
  return rows.map(([open, high, low, close], index) => ({ time: START + index * HOUR, open, high, low, close }));
}

// Builds candles that walk through a list of closing prices, with a small wick on each.
function fromCloses(closes) {
  return fromRows(closes.map((close, index) => {
    const open = index ? closes[index - 1] : close;
    return [open, Math.max(open, close) + 0.1, Math.min(open, close) - 0.1, close];
  }));
}

const analyze = (candles, seconds = HOUR) => APA.smartMoney.analyze(candles, { timeframeSeconds: seconds, swingStrength: 2 });
const ofConcept = (list, concept) => list.filter((item) => item.concept === concept);

// Price rises to a swing high at 103, dips to 99, then closes above that high: one bullish break.
const RISE_DIP_BREAK = [100, 101, 102, 103, 102, 101, 100, 99, 100, 101, 102, 103, 104, 105];

await test('bullish fair value gap: candle 1 high below candle 3 low', () => {
  const candles = fromRows([[10, 10.5, 9.5, 10.2], [10.2, 12, 10.1, 11.9], [11.9, 12.5, 11, 12.3]]);
  const [gap] = ofConcept(analyze(candles).zones, 'fvg');
  assert.equal(gap.direction, 'buy');
  assert.equal(gap.bottom, 10.5);
  assert.equal(gap.top, 11);
});

await test('bearish fair value gap: candle 1 low above candle 3 high', () => {
  const candles = fromRows([[12, 12.5, 11.5, 11.8], [11.8, 11.9, 10, 10.1], [10.1, 11, 9.5, 9.8]]);
  const [gap] = ofConcept(analyze(candles).zones, 'fvg');
  assert.equal(gap.direction, 'sell');
  assert.equal(gap.top, 11.5);
  assert.equal(gap.bottom, 11);
});

await test('a fair value gap price closes through becomes an inverse gap facing the other way', () => {
  const candles = fromRows([[10, 10.5, 9.5, 10.2], [10.2, 12, 10.1, 11.9], [11.9, 12.5, 11, 12.3], [12.3, 12.4, 9.8, 10]]);
  const gap = ofConcept(analyze(candles).zones, 'fvg')[0];
  const [inverse] = ofConcept(analyze(candles).zones, 'ifvg');
  assert.equal(gap.brokenIndex, 3);
  assert.equal(inverse.direction, 'sell');
  assert.equal(inverse.top, gap.top);
});

await test('break of structure: first close past a swing high is a bullish BOS', () => {
  const [event] = ofConcept(analyze(fromCloses(RISE_DIP_BREAK)).events, 'bos');
  assert.equal(event.direction, 'buy');
  assert.equal(event.price, 103.1);
  assert.equal(event.index, 12);
});

await test('market structure shift: a break against the trend is an MSS, not a BOS', () => {
  const analysis = analyze(fromCloses([...RISE_DIP_BREAK, 104, 103, 102, 101, 100, 99, 98, 97]));
  const [shift] = ofConcept(analysis.events, 'mss');
  assert.equal(shift.direction, 'sell');
  assert.equal(analysis.trend, 'down');
});

await test('order block: the last bearish candle before the move that broke structure', () => {
  const candles = fromCloses(RISE_DIP_BREAK);
  const [block] = ofConcept(analyze(candles).zones, 'ob');
  assert.equal(block.direction, 'buy');
  // The candle closing at 99 (index 7) is the last down candle before the rise.
  assert.equal(block.startTime, candles[7].time);
  assert.equal(block.top, candles[7].high);
  assert.equal(block.bottom, candles[7].low);
});

await test('OTE: the box covers the 62% to 79% pullback of the move', () => {
  const candles = fromCloses(RISE_DIP_BREAK);
  const [entry] = ofConcept(analyze(candles).zones, 'ote');
  const legLow = 98.9;
  const legHigh = candles[12].high;
  assert.ok(Math.abs(entry.top - (legHigh - (legHigh - legLow) * 0.62)) < 1e-9);
  assert.ok(Math.abs(entry.bottom - (legHigh - (legHigh - legLow) * 0.79)) < 1e-9);
});

await test('liquidity sweep: a wick past a swing high that closes back below it', () => {
  const candles = fromCloses(RISE_DIP_BREAK.slice(0, 9));
  const swingHigh = 103.1;
  candles.push({ time: candles.at(-1).time + HOUR, open: 100, high: swingHigh + 1, low: 99.9, close: 100.5 });
  const [sweep] = ofConcept(analyze(candles).events, 'sweep');
  assert.equal(sweep.direction, 'sell');
  assert.equal(sweep.price, swingHigh);
});

await test('a candle that CLOSES past the swing is a break, not a sweep', () => {
  assert.equal(ofConcept(analyze(fromCloses(RISE_DIP_BREAK)).events, 'sweep').filter((sweep) => sweep.direction === 'sell').length, 0);
});

await test('breakout: a close outside a tight 20-candle range', () => {
  const rows = [];
  for (let index = 0; index < 25; index++) rows.push([100, 100.5, 99.5, index % 2 ? 100.2 : 99.8]);
  rows.push([100, 104, 99.9, 103.5]);
  const [breakout] = ofConcept(analyze(fromRows(rows)).events, 'breakout');
  assert.equal(breakout.direction, 'buy');
  assert.equal(breakout.box.top, 100.5);
});

await test('CRT: a 4H candle wicks above the last one and closes back inside', () => {
  // Starts on a 4H boundary. The first bucket is ignored as possibly incomplete, so three 4H candles are needed.
  const base = Math.floor(START / 14400) * 14400 + 14400;
  // A 15m chart uses 4H candles as its next timeframe up, so each 4H candle is 16 of these.
  const quarter = (bucket, offset, row) => ({ time: base + bucket * 14400 + offset * 900, open: row[0], high: row[1], low: row[2], close: row[3] });
  const candles = [];
  for (const bucket of [0, 1]) for (let offset = 0; offset < 16; offset++) candles.push(quarter(bucket, offset, [100, 102, 98, 100]));
  for (let offset = 0; offset < 16; offset++) candles.push(quarter(2, offset, offset === 5 ? [100, 105, 99.5, 100] : [100, 101, 99.5, 100]));
  const setups = ofConcept(APA.smartMoney.analyze(candles, { timeframeSeconds: 900, swingStrength: 2 }).events, 'crt');
  assert.equal(setups.length, 1);
  assert.equal(setups[0].direction, 'sell');
  assert.equal(setups[0].time, candles.at(-1).time);
});

await test('CRT never fires before its higher-timeframe candle has fully closed, even with misaligned candle times', () => {
  const base = Math.floor(START / 14400) * 14400 + 14400 + 100;
  const candles = [];
  for (let index = 0; index < 400; index++) {
    const wave = Math.sin(index / 3) * 5;
    candles.push({ time: base + index * 900, open: 100 + wave, high: 103 + wave + (index % 7), low: 97 + wave - (index % 5), close: 100.5 + wave });
  }
  const cutEvents = (list) => APA.smartMoney.analyze(list, { timeframeSeconds: 900, swingStrength: 2 }).events.filter((event) => event.concept === 'crt').map((event) => event.id);
  const full = APA.smartMoney.analyze(candles, { timeframeSeconds: 900, swingStrength: 2 }).events.filter((event) => event.concept === 'crt');
  assert.ok(full.length > 0, 'expected some CRT setups');
  for (const event of full) {
    // Cutting the data at the signal candle must still produce this exact signal, or it used a later candle.
    assert.ok(cutEvents(candles.slice(0, event.index + 1)).includes(event.id), `CRT at index ${event.index} needed a later candle`);
  }
});

await test('New York hour follows daylight saving', () => {
  // 15:00 UTC is 11:00 New York in July (UTC-4) and 10:00 in January (UTC-5).
  assert.equal(APA.smartMoney.newYorkHour(Date.UTC(2026, 6, 1, 15) / 1000), 11);
  assert.equal(APA.smartMoney.newYorkHour(Date.UTC(2026, 0, 15, 15) / 1000), 10);
});

await test('a zone is touched only after it forms, and closing through it ends it', () => {
  const candles = fromRows([[10, 10.5, 9.5, 10.2], [10.2, 12, 10.1, 11.9], [11.9, 12.5, 11, 12.3], [12.3, 13, 12.2, 12.8], [12.8, 12.9, 10.9, 11.5], [11.5, 11.6, 10, 10.1]]);
  const gap = ofConcept(analyze(candles).zones, 'fvg')[0];
  assert.equal(gap.touchedIndex, 4);
  assert.equal(gap.brokenIndex, 5);
});

await test('no look-ahead: later candles never change or remove earlier events', async () => {
  const feed = new APA.DemoFeed(APA.settings.instruments(APA.settings.defaults()));
  for (const [symbol, seconds] of [['R_75', 900], ['frxXAUUSD', 300], ['R_100', 3600]]) {
    const candles = await feed.candles(symbol, seconds, 1800);
    const cut = Math.floor(candles.length * 0.7);
    const early = APA.smartMoney.analyze(candles.slice(0, cut), { timeframeSeconds: seconds });
    const full = APA.smartMoney.analyze(candles, { timeframeSeconds: seconds });
    const cutTime = candles[cut - 1].time;
    const keys = (analysis) => analysis.events.filter((event) => event.time <= cutTime).map((event) => `${event.id}@${event.time}`).sort();
    assert.ok(keys(early).length > 20, `${symbol}: expected many events`);
    assert.deepEqual(keys(early), keys(full), `${symbol}: events changed when future candles were added`);
    for (const concept of APA.smartMoney.concepts) {
      if (seconds > 900 && concept.id === 'silverBullet') continue;
      console.log(`       ${symbol} ${concept.short}: ${ofConcept(full.events, concept.id).length}`);
    }
  }
});

// A stand-in for the live market, so the watcher can be tested with candles the test controls.
function fakeMarket(candles) {
  return {
    candles,
    chartCandles: async function (symbol, seconds, count) { return this.candles.slice(-count); },
    closedCandles: async function (symbol, seconds, count) { return this.candles.slice(0, -1).slice(-count); },
  };
}

await test('watcher: stays quiet about old setups, then alerts once for a live zone touch', async () => {
  const closes = fromCloses(RISE_DIP_BREAK);
  const lastBar = closes.at(-1);
  const market = fakeMarket([...closes, { time: lastBar.time + HOUR, open: 105, high: 105.2, low: 104.8, close: 105 }]);
  const received = [];
  const config = { symbols: ['R_75'], timeframe: '1h', concepts: Object.fromEntries(APA.smartMoney.concepts.map((item) => [item.id, true])) };
  const watcher = new APA.AlertWatcher({ market, getConfig: () => config, onAlerts: (alerts) => received.push(...alerts), onStatus: () => {}, now: () => lastBar.time + HOUR * 1.5 });

  await watcher.checkAllMarkets();
  assert.equal(received.length, 0, 'the first look must not alert about what is already there');

  // The forming candle now dips into the order block at the 99 candle.
  market.candles.at(-1).low = 98.95;
  await watcher.checkAllMarkets();
  const touches = received.filter((alert) => alert.concept === 'ob');
  assert.equal(touches.length, 1);
  assert.equal(touches[0].symbol, 'R_75');
  assert.match(touches[0].message, /Price reached a bullish order block/);

  const count = received.length;
  await watcher.checkAllMarkets();
  assert.equal(received.length, count, 'the same touch must not alert twice');
});

await test('watcher: a muted concept stays quiet, and a failing market is reported', async () => {
  const closes = fromCloses(RISE_DIP_BREAK);
  const lastBar = closes.at(-1);
  const market = fakeMarket([...closes, { time: lastBar.time + HOUR, open: 105, high: 105.2, low: 104.8, close: 105 }]);
  const received = [];
  const statuses = [];
  const config = { symbols: ['R_75'], timeframe: '1h', concepts: {} };
  const watcher = new APA.AlertWatcher({ market, getConfig: () => config, onAlerts: (alerts) => received.push(...alerts), onStatus: (status) => statuses.push(status), now: () => lastBar.time + HOUR * 1.5 });
  await watcher.checkAllMarkets();
  market.candles.at(-1).low = 98.95;
  await watcher.checkAllMarkets();
  assert.equal(received.length, 0);
  market.chartCandles = async () => { throw new Error('Connection to Deriv closed.'); };
  await watcher.checkAllMarkets();
  assert.equal(statuses.at(-1).failures[0].symbol, 'R_75');
});

await test('Deriv feed: a one-candle request asks for two and returns the newest', async () => {
  loadScripts(['js/data/deriv-feed.js']);
  const feed = new APA.DerivFeed({ endpoint: 'wss://example.invalid', appId: '1' });
  const asked = [];
  feed.connect = async () => {};
  feed.request = async (payload) => {
    asked.push(payload.count);
    return { candles: [{ epoch: 900, open: 1, high: 2, low: 0, close: 1 }, { epoch: 1800, open: 2, high: 3, low: 1, close: 2 }] };
  };
  const candles = await feed.candles('R_75', 900, 1);
  assert.deepEqual(asked, [2]);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].time, 1800);
});

console.log(`\n${passed} tests passed.`);
