// Does a confirmation candle make the fair value gap retest profitable on the Vix markets?
// Run: node research/fvg-return/confirmation.mjs
// The best rule is picked on the first 70% of the data, then judged on the last 30%, which played no part in choosing it.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKETS, SPREAD_SHARE, randomSource, readCandles, shuffledCandles, simulate, summarize } from './study.mjs';
import { CONFIRMATIONS, STOPS, TARGETS, confirmationRule } from './confirmation-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { structure } = globalThis.APA;
const TIMEFRAMES = ['5m', '15m', '1h'];
const FIRST_PART = 0.7;
const STRONG_T = 3;

/** Runs one rule over the given markets and splits the results into the first 70% and last 30% of each market's history. */
function runRule(markets, confirms, needsTrend, stopKind, target) {
  const result = { gross: [], net: [], firstNet: [], lastNet: [], lastGross: [], marketsUp: 0, marketsUpLast: 0 };
  for (const { symbol, list, trendAt } of markets) {
    const trades = simulate(list, SPREAD_SHARE[symbol], confirmationRule(confirms, needsTrend, stopKind, target, trendAt));
    const cut = Math.floor(list.length * FIRST_PART);
    const lastPart = trades.filter((trade) => trade.index >= cut);
    result.gross.push(...trades.map((trade) => trade.grossR));
    result.net.push(...trades.map((trade) => trade.netR));
    result.firstNet.push(...trades.filter((trade) => trade.index < cut).map((trade) => trade.netR));
    result.lastNet.push(...lastPart.map((trade) => trade.netR));
    result.lastGross.push(...lastPart.map((trade) => trade.grossR));
    if (summarize(trades.map((trade) => trade.netR)).mean > 0) result.marketsUp++;
    if (summarize(lastPart.map((trade) => trade.netR)).mean > 0) result.marketsUpLast++;
  }
  return result;
}

/** Prepares a market: its candles and the trend at each candle. */
const prepare = (symbol, list) => ({ symbol, list, trendAt: structure.analyze(list, 3).trendAt });

/** Builds candles from a pure random walk, where no rule can have an edge. */
function randomWalk(bars, random) {
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const list = [];
  let price = 100000;
  for (let bar = 0; bar < bars; bar++) {
    const open = price; let high = price; let low = price;
    for (let tick = 0; tick < 100; tick++) { price += gaussian(); high = Math.max(high, price); low = Math.min(low, price); }
    list.push({ time: bar * 900, open, high, low, close: price });
  }
  return list;
}

const lines = [];
const out = (text = '') => { console.log(text); lines.push(text); };
const label = (name, stopKind, target) => `${name}, ${stopKind} stop, ${target}R`;

// Safety check first: on a pure random walk, results before spread must be about zero or the simulator cannot be trusted.
out('===== SIMULATOR CHECK ON A PURE RANDOM WALK (before spread) =====');
const walk = [prepare('R_10', randomWalk(200000, randomSource(5)))];
let worstT = 0;
for (const [name, confirms, needsTrend] of CONFIRMATIONS) {
  for (const stopKind of STOPS) {
    const row = TARGETS.map((target) => { const s = summarize(runRule(walk, confirms, needsTrend, stopKind, target).gross); worstT = Math.max(worstT, s.t); return `${target}R ${s.mean.toFixed(3)} (t ${s.t.toFixed(1)})`; });
    out(`${`${name}, ${stopKind} stop`.padEnd(32)} ${row.join(' | ')}`);
  }
}
out(`Highest false profit t on random data: ${worstT.toFixed(1)}. Above ${STRONG_T} would mean a simulator problem.`);

const summaries = [];
for (const timeframe of TIMEFRAMES) {
  const markets = MARKETS.map((symbol) => prepare(symbol, readCandles(symbol, timeframe)));
  out(`\n===== ${timeframe}: ALL RULES =====`);
  out('Rule                                      trades  win    before    after    t   | first 70%  | last 30%   | markets up');
  for (const [name, confirms, needsTrend] of CONFIRMATIONS) {
    for (const stopKind of STOPS) {
      for (const target of TARGETS) {
        const r = runRule(markets, confirms, needsTrend, stopKind, target);
        const all = summarize(r.net); const first = summarize(r.firstNet); const last = summarize(r.lastNet);
        summaries.push({ timeframe, name, confirms, needsTrend, stopKind, target, first, last, all, gross: summarize(r.gross), lastGross: summarize(r.lastGross), marketsUp: r.marketsUp, marketsUpLast: r.marketsUpLast, markets });
        out(`${label(name, stopKind, target).padEnd(41)} ${String(all.n).padStart(6)} ${(all.win * 100).toFixed(1).padStart(5)}% ${summarize(r.gross).mean.toFixed(3).padStart(8)} ${all.mean.toFixed(3).padStart(8)} ${all.t.toFixed(1).padStart(6)} | ${first.mean.toFixed(3).padStart(8)}   | ${last.mean.toFixed(3).padStart(8)}   | ${r.marketsUp}/10`);
      }
    }
  }
}

out(`\n===== PICKING THE BEST ON THE FIRST 70%, THEN JUDGING ON THE UNSEEN LAST 30% (${summaries.length} rules tried) =====`);
const ranked = [...summaries].sort((one, two) => two.first.mean - one.first.mean);
out(`Rules profitable after spread on the first 70%: ${summaries.filter((s) => s.first.mean > 0).length} of ${summaries.length}`);
out(`Rules profitable on all data after spread: ${summaries.filter((s) => s.all.mean > 0).length}. Rules profitable before spread: ${summaries.filter((s) => s.gross.mean > 0).length}`);
for (const s of ranked.slice(0, 6)) {
  const random = randomSource(s.target * 101 + s.timeframe.length);
  const shuffledMarkets = s.markets.map(({ symbol, list }) => prepare(symbol, shuffledCandles(list, random)));
  const shuffled = runRule(shuffledMarkets, s.confirms, s.needsTrend, s.stopKind, s.target);
  out(`${s.timeframe.padEnd(3)} ${label(s.name, s.stopKind, s.target).padEnd(41)} first 70% ${s.first.mean.toFixed(3)} (t ${s.first.t.toFixed(1)}, n ${s.first.n}) | UNSEEN 30% ${s.last.mean.toFixed(3)} (t ${s.last.t.toFixed(1)}, n ${s.last.n}, win ${(s.last.win * 100).toFixed(1)}%, ${s.marketsUpLast}/10 markets up) | shuffled before spread ${summarize(shuffled.gross).mean.toFixed(3)} vs real ${s.gross.mean.toFixed(3)}`);
}
writeFileSync(join(HERE, 'CONFIRMATION-RESULTS.txt'), `${lines.join('\n')}\n`);
process.exit(0);
