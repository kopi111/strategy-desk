// Does price really return to fair value gaps on the Vix markets, more than it returns to any level the same distance away?
// Run: node research/fvg-return/study.mjs
// Three checks: 1) return rates against fake levels and shuffled candles, 2) what predicts a return, 3) whether trading it pays.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { loadCore } = await import(pathToFileURL(join(HERE, '..', '..', 'tests', 'load-core.mjs')).href);
const APA = loadCore();

export const MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
const TIMEFRAMES = ['5m', '15m', '1h'];
const SECONDS = { '5m': 300, '15m': 900, '1h': 3600 };
export const HORIZONS = [5, 20, 100, 500];
const LONGEST_HORIZON = 500;
// Spread as a share of price, from the desk's instrument list. The three marked below have no listed spread, so they borrow the sibling's.
export const SPREAD_SHARE = { R_10: 0.6 / 4860, R_25: 1.2 / 2930, R_50: 0.05 / 99, R_75: 25 / 34800, R_100: 0.4 / 570, '1HZ10V': 0.6 / 4860, '1HZ25V': 1.2 / 2930, '1HZ50V': 0.05 / 99, '1HZ75V': 2 / 4660, '1HZ100V': 0.4 / 1315 };
const SHUFFLE_RUNS = 5;

// The same gap rule the Desk draws: minimum gap of 0.25 of the 50-candle average range.
const MINIMUM_GAP_RANGES = 0.25;
const AVERAGE_BARS = 50;
const MINIMUM_RISK_RANGES = 0.25;

/** A small repeatable random number generator, so the study gives the same answer each run. */
export function randomSource(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Reads one downloaded candle file. */
export function readCandles(symbol, timeframe) {
  const file = join(HERE, 'data', `${symbol}_${timeframe}.csv`);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8').trim().split('\n').slice(1).map((line) => {
    const [time, open, high, low, close] = line.split(',').map(Number);
    return { time, open, high, low, close };
  });
}

/** Works out the 50-candle average range for every candle in one pass. */
export function averageRanges(candles) {
  const averages = new Array(candles.length);
  let total = 0;
  for (let index = 0; index < candles.length; index++) {
    total += candles[index].high - candles[index].low;
    if (index >= AVERAGE_BARS) total -= candles[index - AVERAGE_BARS].high - candles[index - AVERAGE_BARS].low;
    averages[index] = total / Math.min(index + 1, AVERAGE_BARS);
  }
  return averages;
}

/** Finds gaps as { index, buying, near, far }. Near is the edge price reaches first. */
export function findGaps(candles, averages) {
  const gaps = [];
  for (let index = 2; index < candles.length; index++) {
    const first = candles[index - 2];
    const third = candles[index];
    const minimum = averages[index] * MINIMUM_GAP_RANGES;
    if (third.low - first.high >= minimum) gaps.push({ index, buying: true, near: third.low, far: first.high });
    else if (first.low - third.high >= minimum) gaps.push({ index, buying: false, near: third.high, far: first.low });
  }
  return gaps;
}

/** How many candles until price reaches a level below (buying) or above (selling) it. Infinity means not within the limit. */
export function barsUntilReached(candles, start, level, isBelow, limit = LONGEST_HORIZON) {
  const last = Math.min(candles.length - 1, start + limit);
  for (let index = start + 1; index <= last; index++) {
    if (isBelow ? candles[index].low <= level : candles[index].high >= level) return index - start;
  }
  return Infinity;
}

/** Rebuilds a price path with its candles in random order. Same candles, same volatility, but any real pattern over time is destroyed. */
export function shuffledCandles(candles, random) {
  const shapes = candles.map((c) => ({ high: Math.log(c.high / c.open), low: Math.log(c.low / c.open), close: Math.log(c.close / c.open) }));
  for (let index = shapes.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shapes[index], shapes[other]] = [shapes[other], shapes[index]];
  }
  let price = candles[0].open;
  return shapes.map((shape, index) => {
    const candle = { time: candles[index].time, open: price, high: price * Math.exp(shape.high), low: price * Math.exp(shape.low), close: price * Math.exp(shape.close) };
    price = candle.close;
    return candle;
  });
}

/** Measures one market: every gap, plus a fake level at the same distance on the other side, plus one at a random moment. */
export function measureMarket(candles, random) {
  const averages = averageRanges(candles);
  const usable = candles.length - LONGEST_HORIZON - 1;
  const records = [];
  for (const gap of findGaps(candles, averages)) {
    if (gap.index >= usable || gap.index < AVERAGE_BARS) continue;
    const close = candles[gap.index].close;
    const distance = Math.abs(close - gap.near);
    const width = Math.abs(gap.near - gap.far);
    const average = averages[gap.index];
    // Same moment, same distance, opposite side. Any momentum after the gap candle is shared by both.
    const mirrorLevel = gap.buying ? close + distance : close - distance;
    // A random moment in the same market, at the same distance measured in average ranges.
    const otherIndex = AVERAGE_BARS + Math.floor(random() * (usable - AVERAGE_BARS));
    const scaledDistance = (distance / average) * averages[otherIndex];
    const randomLevel = gap.buying ? candles[otherIndex].close - scaledDistance : candles[otherIndex].close + scaledDistance;
    records.push({
      index: gap.index, buying: gap.buying, distanceRanges: distance / average, widthRanges: width / average,
      toNear: barsUntilReached(candles, gap.index, gap.near, gap.buying),
      toFar: barsUntilReached(candles, gap.index, gap.far, gap.buying),
      toMirror: barsUntilReached(candles, gap.index, mirrorLevel, !gap.buying),
      toRandom: barsUntilReached(candles, otherIndex, randomLevel, gap.buying),
    });
  }
  return { records, gapsPerThousand: (records.length / Math.max(1, usable)) * 1000 };
}

export const share = (records, test) => (records.length ? records.filter(test).length / records.length : NaN);
const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-');

/** The middle value of a list. Levels never reached count as Infinity, so the median stays honest. */
export function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
}

/** Which was reached first: the gap, or the same distance the other way? Ties in one candle are left out, since the order is unknown. */
export function gapFirstShare(records) {
  const decided = records.filter((record) => record.toNear !== record.toMirror && (record.toNear !== Infinity || record.toMirror !== Infinity));
  return { share: share(decided, (record) => record.toNear < record.toMirror), count: decided.length };
}

/** Standard error for a share, grouping records by week so clustered gaps are not counted as independent. */
function weeklyStandardError(records, test, candles) {
  const weeks = new Map();
  for (const record of records) {
    const week = Math.floor(candles[record.index].time / 604800);
    const entry = weeks.get(week) || { hits: 0, total: 0 };
    entry.total++;
    if (test(record)) entry.hits++;
    weeks.set(week, entry);
  }
  const rates = [...weeks.values()].map((week) => week.hits / week.total);
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  const variance = rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / Math.max(1, rates.length - 1);
  return Math.sqrt(variance / rates.length);
}

/**
 * Simulates one rule, one trade at a time per market. Results are in R, before and after spread.
 * Trades are taken in the order they START, not the order their gaps formed. Going by formation order looked into the
 * future: a trade was only chosen if an older gap was never touched later, which means price did not go against it.
 * That pushed the win rate on a pure random walk to 32.6% where 25% is the fair figure.
 */
export function simulate(candles, spreadShare, rule) {
  const averages = averageRanges(candles);
  const plans = findGaps(candles, averages).filter((gap) => gap.index >= AVERAGE_BARS)
    .map((gap) => rule(candles, gap, averages[gap.index])).filter(Boolean)
    .sort((first, second) => first.entryIndex - second.entryIndex);
  const trades = [];
  let freeFrom = 0;
  for (const plan of plans) {
    if (plan.entryIndex < freeFrom) continue;
    const trade = runTrade(candles, plan, spreadShare);
    if (!trade) continue;
    trades.push(trade);
    freeFrom = trade.exitIndex + 1;
  }
  return trades;
}

/** Plays a trade forward. If the stop and target are both inside one candle, the stop counts first, the cautious choice. */
export function runTrade(candles, plan, spreadShare) {
  const { entryIndex, entry, stop, target, buying, maxBars } = plan;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const spreadR = (entry * spreadShare) / risk;
  const toR = (price) => (buying ? price - entry : entry - price) / risk;
  const last = Math.min(candles.length - 1, entryIndex + maxBars);
  for (let index = entryIndex; index <= last; index++) {
    const candle = candles[index];
    // A real market can open past the stop after a closed period. The trade then exits at that worse price, not at the stop.
    const openedPastStop = index > entryIndex && (buying ? candle.open < stop : candle.open > stop);
    if (openedPastStop) { const r = toR(candle.open); return { index: entryIndex, exitIndex: index, buying, grossR: r, netR: r - spreadR }; }
    const hitStop = buying ? candle.low <= stop : candle.high >= stop;
    // The target only counts from the next candle when the entry candle touched the entry price part-way through.
    const hitTarget = (index > entryIndex || plan.enteredAtOpen) && (buying ? candle.high >= target : candle.low <= target);
    if (hitStop) return { index: entryIndex, exitIndex: index, buying, grossR: -1, netR: -1 - spreadR };
    if (hitTarget) { const r = toR(target); return { index: entryIndex, exitIndex: index, buying, grossR: r, netR: r - spreadR }; }
  }
  if (last < entryIndex) return null;
  const r = toR(candles[last].close);
  return { index: entryIndex, exitIndex: last, buying, grossR: r, netR: r - spreadR };
}

/** The rule your idea suggests: as soon as a gap forms, trade back towards it, with the stop the same distance away. */
export const tradeBackToGap = (candles, gap, average) => {
  const entryIndex = gap.index + 1;
  if (entryIndex >= candles.length) return null;
  const entry = candles[entryIndex].open;
  const distance = gap.buying ? entry - gap.near : gap.near - entry;
  if (distance < average * 0.5) return null;
  return { entryIndex, entry, buying: !gap.buying, target: gap.near, stop: gap.buying ? entry + distance : entry - distance, maxBars: 200, enteredAtOpen: true };
};

/**
 * The textbook rule: wait for price to return to the gap, then trade away from it, with the stop past the gap's far edge.
 * Entry is the open of the candle after the touch, a price that was really available, rather than assuming a perfect
 * fill exactly at the gap edge.
 */
export const tradeRetest = (rewardToRisk) => (candles, gap, average) => {
  const touchBars = barsUntilReached(candles, gap.index, gap.near, gap.buying, 100);
  if (touchBars === Infinity) return null;
  const entryIndex = gap.index + touchBars + 1;
  if (entryIndex >= candles.length) return null;
  const entry = candles[entryIndex].open;
  const stop = gap.buying ? gap.far - average * 0.5 : gap.far + average * 0.5;
  const risk = gap.buying ? entry - stop : stop - entry;
  // Skip if price is already past the stop, or so close that the spread alone could exceed the stop. Nobody could take those.
  if (risk < average * MINIMUM_RISK_RANGES) return null;
  return { entryIndex, entry, buying: gap.buying, stop, target: gap.buying ? entry + risk * rewardToRisk : entry - risk * rewardToRisk, maxBars: 500, enteredAtOpen: true };
};

/** Average, t-statistic and win rate for a list of R results. */
export function summarize(values) {
  if (!values.length) return { n: 0, mean: NaN, t: NaN, win: NaN };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return { n: values.length, mean, t: mean / Math.sqrt(variance / values.length), win: values.filter((value) => value > 0).length / values.length };
}

const lines = [];
const out = (text = '') => { console.log(text); lines.push(text); };

/** Checks this fast gap code matches what the Desk really draws, so the study tests the same thing you see. */
function checkAgainstDesk(candles) {
  const sample = candles.slice(0, 1500);
  const seconds = sample[1].time - sample[0].time;
  const desk = APA.smartMoney.analyze(sample, { timeframeSeconds: seconds }).zones.filter((zone) => zone.concept === 'fvg');
  const mine = findGaps(sample, averageRanges(sample));
  const same = desk.length === mine.length && desk.every((zone, position) => zone.formedIndex === mine[position].index && Math.abs((zone.direction === 'buy' ? zone.top : zone.bottom) - mine[position].near) < 1e-9);
  if (!same) throw new Error(`Gap code does not match the Desk: desk ${desk.length}, study ${mine.length}`);
  return desk.length;
}

function main() {
const data = {};
for (const timeframe of TIMEFRAMES) {
  data[timeframe] = {};
  for (const symbol of MARKETS) {
    const candles = readCandles(symbol, timeframe);
    if (candles) data[timeframe][symbol] = candles;
  }
}
out(`Gap code matches the Desk on a sample: ${checkAgainstDesk(data['15m'].R_75)} gaps compared.`);
out(`Period: ${new Date(data['15m'].R_75[0].time * 1000).toISOString().slice(0, 10)} to ${new Date(data['15m'].R_75.at(-1).time * 1000).toISOString().slice(0, 10)}`);

const pooled = {};
for (const timeframe of TIMEFRAMES) {
  out(`\n===== ${timeframe}: DOES PRICE COME BACK? =====`);
  let all = [];
  const shuffledAll = [];
  const perMarket = [];
  let standardError = 0;
  let marketCount = 0;
  for (const [symbol, candles] of Object.entries(data[timeframe])) {
    const random = randomSource(symbol.length * 1000 + SECONDS[timeframe]);
    const { records } = measureMarket(candles, random);
    all = all.concat(records);
    const { share: firstShare, count } = gapFirstShare(records);
    perMarket.push(`${symbol.padEnd(8)} candles ${String(candles.length).padStart(6)} gaps ${String(records.length).padStart(6)} touched in 20 ${percent(share(records, (r) => r.toNear <= 20)).padStart(6)} gap-first ${percent(firstShare).padStart(6)} of ${count}`);
    standardError += weeklyStandardError(records, (r) => r.toNear < r.toMirror, candles) ** 2;
    marketCount++;
    for (let run = 0; run < SHUFFLE_RUNS; run++) shuffledAll.push(...measureMarket(shuffledCandles(candles, random), random).records);
  }
  pooled[timeframe] = all;
  out(`Gaps measured: ${all.length} across ${marketCount} markets`);
  out('Within N candles | reach gap edge | fill whole gap | fake: other side | fake: random moment | SHUFFLED candles: edge');
  for (const horizon of HORIZONS) {
    out(`${String(horizon).padStart(16)} | ${percent(share(all, (r) => r.toNear <= horizon)).padStart(14)} | ${percent(share(all, (r) => r.toFar <= horizon)).padStart(14)} | ${percent(share(all, (r) => r.toMirror <= horizon)).padStart(16)} | ${percent(share(all, (r) => r.toRandom <= horizon)).padStart(19)} | ${percent(share(shuffledAll, (r) => r.toNear <= horizon)).padStart(10)}`);
  }
  out(`Median candles to reach the gap edge: ${median(all.map((r) => r.toNear))}. Same distance the other way: ${median(all.map((r) => r.toMirror))}. Shuffled candles: ${median(shuffledAll.map((r) => r.toNear))}.`);
  const firstReal = gapFirstShare(all);
  const firstShuffled = gapFirstShare(shuffledAll);
  out(`Reached the gap BEFORE the same distance the other way: ${percent(firstReal.share)} of ${firstReal.count} (about +/-${(2 * Math.sqrt(standardError) / marketCount * 100).toFixed(1)}% by weekly grouping). Shuffled candles: ${percent(firstShuffled.share)}. No effect would be about the shuffled figure.`);
  perMarket.forEach((row) => out(row));
}

/** Compares real gaps with the fake other-side level, inside one group of gaps. */
function bucketRow(label, records) {
  const first = gapFirstShare(records);
  return `${label.padEnd(30)} gaps ${String(records.length).padStart(6)} | edge in 20 ${percent(share(records, (r) => r.toNear <= 20)).padStart(6)} | other side in 20 ${percent(share(records, (r) => r.toMirror <= 20)).padStart(6)} | gap first ${percent(first.share).padStart(6)}`;
}

out('\n===== 15m: WHAT TELLS US IT WILL COME BACK? =====');
const gaps15 = pooled['15m'];
out('By how far price is from the gap, in average candle ranges:');
for (const [low, high] of [[0, 0.25], [0.25, 0.5], [0.5, 1], [1, 2], [2, Infinity]]) out(bucketRow(`distance ${low} to ${high}`, gaps15.filter((r) => r.distanceRanges >= low && r.distanceRanges < high)));
out('By gap size, in average candle ranges:');
for (const [low, high] of [[0.25, 0.5], [0.5, 1], [1, 2], [2, Infinity]]) out(bucketRow(`size ${low} to ${high}`, gaps15.filter((r) => r.widthRanges >= low && r.widthRanges < high)));
out('By direction:');
out(bucketRow('bullish gap (price above)', gaps15.filter((r) => r.buying)));
out(bucketRow('bearish gap (price below)', gaps15.filter((r) => !r.buying)));

const trendRows = { with: [], against: [] };
for (const [symbol, candles] of Object.entries(data['15m'])) {
  const { trendAt } = APA.structure.analyze(candles, 3);
  const random = randomSource(symbol.length * 77);
  for (const record of measureMarket(candles, random).records) {
    const trend = trendAt[record.index];
    if (trend === 'none') continue;
    ((trend === 'up') === record.buying ? trendRows.with : trendRows.against).push(record);
  }
}
out('By trend when the gap formed:');
out(bucketRow('gap in the trend direction', trendRows.with));
out(bucketRow('gap against the trend', trendRows.against));

out('\n===== CAN IT BE TRADED? One trade at a time per market. Results in R. =====');
const RULES = [['Trade back to the gap (1:1)', tradeBackToGap], ['Buy/sell the retest, 1R target', tradeRetest(1)], ['Buy/sell the retest, 2R target', tradeRetest(2)], ['Buy/sell the retest, 3R target', tradeRetest(3)]];
for (const timeframe of TIMEFRAMES) {
  out(`\n--- ${timeframe} ---`);
  out('Rule                              trades  win    gross R   net R   net t  | last 30% net R (t) | markets up | SHUFFLED net R');
  for (const [name, rule] of RULES) {
    let net = [];
    let gross = [];
    let late = [];
    let marketsUp = 0;
    let marketsTotal = 0;
    const shuffledNet = [];
    for (const [symbol, candles] of Object.entries(data[timeframe])) {
      const trades = simulate(candles, SPREAD_SHARE[symbol], rule);
      net = net.concat(trades.map((t) => t.netR));
      gross = gross.concat(trades.map((t) => t.grossR));
      const cut = Math.floor(candles.length * 0.7);
      late = late.concat(trades.filter((t) => t.index >= cut).map((t) => t.netR));
      marketsTotal++;
      if (summarize(trades.map((t) => t.netR)).mean > 0) marketsUp++;
      const random = randomSource(symbol.length * 13 + SECONDS[timeframe]);
      for (let run = 0; run < 2; run++) shuffledNet.push(...simulate(shuffledCandles(candles, random), SPREAD_SHARE[symbol], rule).map((t) => t.netR));
    }
    const all = summarize(net);
    const later = summarize(late);
    const shuffled = summarize(shuffledNet);
    out(`${name.padEnd(32)} ${String(all.n).padStart(7)} ${percent(all.win).padStart(6)} ${summarize(gross).mean.toFixed(3).padStart(8)} ${all.mean.toFixed(3).padStart(8)} ${all.t.toFixed(1).padStart(7)}  | ${later.mean.toFixed(3).padStart(7)} (${later.t.toFixed(1)}) | ${marketsUp}/${marketsTotal} | ${shuffled.mean.toFixed(3)}`);
  }
}

writeFileSync(join(HERE, 'RESULTS.txt'), `${lines.join('\n')}\n`);
process.exit(0);
}

// Only runs the study when this file is started directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
