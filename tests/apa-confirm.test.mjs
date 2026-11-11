// Run: node tests/apa-confirm.test.mjs
// Checks the chart's APA 15m-setup / 5m-confirmation code against the Python backtest it was ported from.
// tests/fixtures/apa-confirm-parity.json holds the Python trades for a full year of three Vix markets; the candles
// themselves are in research/fvg-return/data (not in git), so that part is skipped when they are missing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from './load-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APA = loadCore();
const { findSetups, replay, stateFrom } = APA.apaConfirm;
const FIVE_MINUTES = 300;

// Runs one named test and prints the result.
function test(name, body) {
  body();
  console.log(`ok   ${name}`);
}

/** Reads a Deriv 5m CSV the same way the Python study does: times floored to 5 minutes, duplicates dropped. */
function readCandles(file) {
  const seen = new Set();
  return readFileSync(join(ROOT, file), 'utf8').trim().split('\n').slice(1).map((line) => line.split(',').map(Number))
    .map(([time, open, high, low, close]) => ({ time: Math.floor(time / FIVE_MINUTES) * FIVE_MINUTES, open, high, low, close }))
    .filter((candle) => !seen.has(candle.time) && seen.add(candle.time))
    .sort((first, second) => first.time - second.time);
}

const fixtures = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/apa-confirm-parity.json'), 'utf8'));
for (const [symbol, fixture] of Object.entries(fixtures)) {
  if (!existsSync(join(ROOT, fixture.file))) { console.log(`skip ${symbol}: ${fixture.file} is not on this computer`); continue; }
  test(`${symbol}: same trades as the Python backtest (${fixture.trades.length} trades, RR ${fixture.rr})`, () => {
    const candles = readCandles(fixture.file);
    const setups = findSetups(APA.candles.resample(candles, APA.apaConfirm.SETUP_SECONDS));
    const { trades } = replay(candles, setups, { rr: fixture.rr, stopAtr: fixture.stopAtr, spread: fixture.spread });
    assert.equal(trades.length, fixture.trades.length, 'number of trades');
    fixture.trades.forEach((expected, index) => {
      const actual = trades[index];
      assert.equal(actual.entryTime, expected.entryTime, `trade ${index} entry time`);
      assert.equal(actual.exitTime, expected.exitTime, `trade ${index} exit time`);
      assert.equal(actual.side, expected.side, `trade ${index} side`);
      assert.ok(Math.abs(actual.netR - expected.netR) < 1e-6, `trade ${index} net R ${actual.netR} vs ${expected.netR}`);
    });
  });
}

// A hand-built market: a rise and a pullback set structure, a break up, then a sweep of the invalidation level.
function buildSweepMarket() {
  const prices = [100, 101, 102, 103, 104, 105, 104, 103, 102, 101, 100, 101, 102, 103, 104, 105, 106, 107, 108, 107, 106, 105, 104, 103, 102, 103, 104];
  const candles = prices.map((price, index) => ({ time: index * 900, open: price - 0.2, high: price + 0.5, low: price - 0.5, close: price + 0.2 }));
  // Candle 27 sweeps below the swing low at 99.5 and closes back above it.
  candles.push({ time: 27 * 900, open: 101, high: 101.5, low: 99, close: 100.8 });
  return candles;
}

test('a sweep is only known when its 15m candle has closed', () => {
  const setups = findSetups(buildSweepMarket());
  assert.ok(setups.length >= 1);
  for (const setup of setups) assert.equal(setup.knownAt, setup.time + 900);
});

test('with no 5m candles after the setup, it is shown as waiting, not as a trade', () => {
  const setups = [{ time: 0, knownAt: 900, side: 1, high: 101, low: 99, level: 99.5 }];
  const fiveMinute = Array.from({ length: 4 }, (_, index) => ({ time: index * 300, open: 100, high: 100.5, low: 99.8, close: 100.1 }));
  const state = stateFrom(replay(fiveMinute, setups, { rr: 2, stopAtr: 0 }));
  assert.equal(state.status, 'waiting');
  assert.equal(state.side, 1);
  assert.equal(state.cancelAt, 99);
});

test('a 5m close below the sweep candle cancels the setup', () => {
  const setups = [{ time: 0, knownAt: 900, side: 1, high: 101, low: 99, level: 99.5 }];
  const fiveMinute = [0, 300, 600, 900].map((time) => ({ time, open: 100, high: 100.5, low: 99.8, close: 100.1 }));
  fiveMinute.push({ time: 1200, open: 99.5, high: 99.6, low: 98.5, close: 98.8 });
  const result = replay(fiveMinute, setups, { rr: 2, stopAtr: 0 });
  assert.equal(stateFrom(result).status, 'none');
  assert.ok(result.events.some((event) => event.kind === 'cancelled'));
});
