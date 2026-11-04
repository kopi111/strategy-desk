// Safety check for the trade simulator. On a pure random walk no rule can have an edge, so results before spread must be about zero.
// Run: node research/fvg-return/bias-check.mjs   It stops with an error if the simulator looks biased.
import { randomSource, simulate, summarize, tradeBackToGap, tradeRetest } from './study.mjs';

/** Builds candles from a random walk of ticks. No patterns exist in this data by construction. */
function tickCandles(bars, ticksPerBar, random) {
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const candles = [];
  let price = 100000;
  for (let bar = 0; bar < bars; bar++) {
    const open = price; let high = price; let low = price;
    for (let tick = 0; tick < ticksPerBar; tick++) { price += gaussian(); high = Math.max(high, price); low = Math.min(low, price); }
    candles.push({ time: bar * 900, open, high, low, close: price });
  }
  return candles;
}

const candles = tickCandles(300000, 100, randomSource(99));
const rules = [['trade back to the gap', tradeBackToGap, 0.5], ['retest 1R', tradeRetest(1), 0.5], ['retest 2R', tradeRetest(2), 1 / 3], ['retest 3R', tradeRetest(3), 0.25]];
let isBiased = false;
for (const [name, rule, fairWin] of rules) {
  const result = summarize(simulate(candles, 0, rule).map((trade) => trade.grossR));
  const isFair = Math.abs(result.t) < 3;
  if (!isFair) isBiased = true;
  console.log(`${name.padEnd(24)} trades ${String(result.n).padStart(6)}  win ${(result.win * 100).toFixed(1)}% (fair ${(fairWin * 100).toFixed(1)}%)  average ${result.mean.toFixed(3)}R  t ${result.t.toFixed(1)}  ${isFair ? 'fair' : 'BIASED'}`);
}
if (isBiased) { console.error('The simulator is biased. Do not trust the trading results.'); process.exit(1); }
console.log('Simulator passes: about zero on random data.');
