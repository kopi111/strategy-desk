// Fair value gaps on 3 years of real gold prices (HistData 1-minute candles), with the same rules used on the Vix markets.
// Run: node research/fvg-return/gold.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HORIZONS, gapFirstShare, measureMarket, median, randomSource, share, shuffledCandles, simulate, summarize, tradeRetest } from './study.mjs';
import { CONFIRMATIONS, STOPS, TARGETS, confirmationRule } from './confirmation-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const M1_FOLDER = join(HERE, '..', 'backtest-3y', 'm1');
const { candles: candleTools, structure } = globalThis.APA;
const TIMEFRAMES = [['5m', 300], ['15m', 900], ['1h', 3600]];
// HistData stamps are New York standard time with no daylight saving.
const HISTDATA_UTC_OFFSET_SECONDS = 5 * 3600;
// The desk's assumed gold spread: 0.30 at a price of 3,000, scaled with price because spreads widen as gold rises.
const SPREAD_SHARE = 0.3 / 3000;
const FIRST_PART = 0.7;
const LONDON_NEW_YORK_HOURS = [7, 17];
const SESSIONS = [['all hours', () => true], ['London + New York', (time) => { const hour = new Date(time * 1000).getUTCHours(); return hour >= LONDON_NEW_YORK_HOURS[0] && hour < LONDON_NEW_YORK_HOURS[1]; }]];
const SHUFFLES = 5;
const TOP_RULES = 8;
const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-');
const lines = [];
const out = (text = '') => { console.log(text); lines.push(text); };

/** Reads every monthly gold file into one list of 1-minute candles in time order. */
function readGoldMinutes() {
  const files = readdirSync(M1_FOLDER).filter((name) => name.includes('XAUUSD')).sort();
  const minutes = [];
  for (const name of files) {
    for (const line of readFileSync(join(M1_FOLDER, name), 'utf8').trim().split('\n')) {
      const [stamp, open, high, low, close] = line.split(';');
      const time = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13)) / 1000 + HISTDATA_UTC_OFFSET_SECONDS;
      minutes.push({ time, open: +open, high: +high, low: +low, close: +close });
    }
  }
  return minutes;
}

/** A gap is only real if its three candles are back to back. A jump across a weekend is not a fair value gap. */
const isBackToBack = (list, index, seconds) => index >= 2 && list[index].time - list[index - 2].time === 2 * seconds;

/** Limits a rule to real gaps and, optionally, to entries inside a trading session. */
const filteredRule = (rule, seconds, inSession) => (list, gap, average) => {
  if (!isBackToBack(list, gap.index, seconds)) return null;
  const plan = rule(list, gap, average);
  return plan && inSession(list[plan.entryIndex].time) ? plan : null;
};

/** Runs one rule and splits the result by part of the history and by buys and sells. */
function runRule(list, rule) {
  const trades = simulate(list, SPREAD_SHARE, rule);
  const cut = Math.floor(list.length * FIRST_PART);
  const pick = (test, key = 'netR') => summarize(trades.filter(test).map((trade) => trade[key]));
  return {
    trades,
    all: pick(() => true), gross: pick(() => true, 'grossR'),
    first: pick((trade) => trade.index < cut), last: pick((trade) => trade.index >= cut),
    buys: pick((trade) => trade.buying), sells: pick((trade) => !trade.buying),
    lastBuys: pick((trade) => trade.index >= cut && trade.buying), lastSells: pick((trade) => trade.index >= cut && !trade.buying),
  };
}

/** The result of random entries with the same direction, stop and target as the rule. This is what gold's rally alone would give. */
function randomEntryBaseline(list, trades, targetR, random) {
  const results = [];
  const usable = list.length - 600;
  for (const trade of trades) {
    const index = 60 + Math.floor(random() * (usable - 60));
    const risk = candleTools.averageRange(list, index) * trade.riskRanges;
    const entry = list[index].open;
    const stop = trade.buying ? entry - risk : entry + risk;
    const target = trade.buying ? entry + risk * targetR : entry - risk * targetR;
    let r = 0;
    for (let bar = index; bar < index + 500; bar++) {
      const candle = list[bar];
      if (trade.buying ? candle.low <= stop : candle.high >= stop) { r = -1; break; }
      if (trade.buying ? candle.high >= target : candle.low <= target) { r = targetR; break; }
      r = (trade.buying ? candle.close - entry : entry - candle.close) / risk;
    }
    results.push(r - (entry * SPREAD_SHARE) / risk);
  }
  return summarize(results);
}

const minutes = readGoldMinutes();
out(`Gold 1-minute candles: ${minutes.length}, ${new Date(minutes[0].time * 1000).toISOString().slice(0, 10)} to ${new Date(minutes.at(-1).time * 1000).toISOString().slice(0, 10)}. Price ${minutes[0].open} to ${minutes.at(-1).close}.`);

const series = TIMEFRAMES.map(([label, seconds]) => ({ label, seconds, list: candleTools.resample(minutes, seconds) }));
for (const { label, seconds, list } of series) {
  out(`\n===== ${label}: DOES PRICE COME BACK? (${list.length} candles) =====`);
  const random = randomSource(seconds);
  const records = measureMarket(list, random).records.filter((record) => isBackToBack(list, record.index, seconds));
  const shuffled = [];
  for (let run = 0; run < SHUFFLES; run++) shuffled.push(...measureMarket(shuffledCandles(list, random), random).records);
  out(`Gaps: ${records.length}`);
  out('Within N candles | reach gap edge | fill whole gap | fake: other side | fake: random moment | shuffled candles');
  for (const horizon of HORIZONS) out(`${String(horizon).padStart(16)} | ${percent(share(records, (r) => r.toNear <= horizon)).padStart(14)} | ${percent(share(records, (r) => r.toFar <= horizon)).padStart(14)} | ${percent(share(records, (r) => r.toMirror <= horizon)).padStart(16)} | ${percent(share(records, (r) => r.toRandom <= horizon)).padStart(19)} | ${percent(share(shuffled, (r) => r.toNear <= horizon)).padStart(10)}`);
  out(`Median candles to the gap edge: ${median(records.map((r) => r.toNear))}. The other side: ${median(records.map((r) => r.toMirror))}.`);
  const first = gapFirstShare(records); const buys = gapFirstShare(records.filter((r) => r.buying)); const sells = gapFirstShare(records.filter((r) => !r.buying)); const control = gapFirstShare(shuffled);
  const cut = Math.floor(list.length * FIRST_PART);
  const early = gapFirstShare(records.filter((r) => r.index < cut)); const late = gapFirstShare(records.filter((r) => r.index >= cut));
  const standardError = Math.sqrt(first.share * (1 - first.share) / first.count) * 100;
  out(`Gap reached BEFORE the other side: ${percent(first.share)} of ${first.count} (about +/-${(2 * standardError).toFixed(1)}%). Bullish gaps ${percent(buys.share)}, bearish gaps ${percent(sells.share)}. First 70% ${percent(early.share)}, last 30% ${percent(late.share)}. Shuffled: ${percent(control.share)}.`);
}

out('\n===== CAN IT BE TRADED? One trade at a time, after spread, in R =====');
const summaries = [];
for (const { label, seconds, list } of series) {
  const { trendAt } = structure.analyze(list, 3);
  for (const [session, inSession] of SESSIONS) {
    for (const target of TARGETS) {
      summaries.push({ label, seconds, list, session, inSession, target, name: 'no confirmation', stopKind: 'gap', ...runRule(list, filteredRule(tradeRetest(target), seconds, inSession)), make: () => tradeRetest(target) });
      for (const [name, confirms, needsTrend] of CONFIRMATIONS) {
        for (const stopKind of STOPS) {
          const make = (trend = trendAt) => confirmationRule(confirms, needsTrend, stopKind, target, trend);
          summaries.push({ label, seconds, list, session, inSession, target, name, stopKind, needsTrend, ...runRule(list, filteredRule(make(), seconds, inSession)), make });
        }
      }
    }
  }
}
const row = (s) => `${s.label.padEnd(4)}${s.session.padEnd(18)}${`${s.name}, ${s.stopKind} stop, ${s.target}R`.padEnd(44)}${String(s.all.n).padStart(6)} ${percent(s.all.win).padStart(6)} ${s.gross.mean.toFixed(3).padStart(7)} ${s.all.mean.toFixed(3).padStart(7)} ${s.all.t.toFixed(1).padStart(6)} | ${s.first.mean.toFixed(3).padStart(7)} | ${s.last.mean.toFixed(3).padStart(7)} | buys ${s.buys.mean.toFixed(3).padStart(7)} sells ${s.sells.mean.toFixed(3).padStart(7)}`;
out('Timeframe, session, rule                                              trades   win  before   after      t | first70 |  last30 |');
for (const s of summaries) out(row(s));

const ruleCount = summaries.length;
// With this many rules tried, a t above about 3.5 is the bar for "unlikely to be luck".
const LUCK_BAR_T = 3.5;
out(`\n===== PICKED ON THE FIRST 70%, JUDGED ON THE UNSEEN LAST 30% (${ruleCount} rules tried) =====`);
out(`Profitable after spread on the first 70%: ${summaries.filter((s) => s.first.mean > 0).length}. On the last 30%: ${summaries.filter((s) => s.last.mean > 0).length}. On both: ${summaries.filter((s) => s.first.mean > 0 && s.last.mean > 0).length}. Both buys and sells profitable overall: ${summaries.filter((s) => s.buys.mean > 0 && s.sells.mean > 0).length}. Overall t above ${LUCK_BAR_T}: ${summaries.filter((s) => s.all.t > LUCK_BAR_T).length}.`);
for (const s of [...summaries].sort((one, two) => two.first.mean - one.first.mean).slice(0, TOP_RULES)) {
  const random = randomSource(s.target * 31 + s.seconds);
  const shuffledRuns = [];
  for (let run = 0; run < SHUFFLES; run++) {
    const mixed = shuffledCandles(s.list, random);
    const rule = s.name === 'no confirmation' ? s.make() : s.make(structure.analyze(mixed, 3).trendAt);
    shuffledRuns.push(...simulate(mixed, SPREAD_SHARE, filteredRule(rule, s.seconds, s.inSession)).map((trade) => trade.netR));
  }
  const control = summarize(shuffledRuns);
  const withRisk = s.trades.map((trade) => ({ ...trade, riskRanges: 1 }));
  const baseline = randomEntryBaseline(s.list, withRisk, s.target, random);
  out(`\n${s.label} ${s.session}, ${s.name}, ${s.stopKind} stop, ${s.target}R`);
  out(`  first 70%: ${s.first.mean.toFixed(3)}R (t ${s.first.t.toFixed(1)}, n ${s.first.n}, win ${percent(s.first.win)})`);
  out(`  UNSEEN 30%: ${s.last.mean.toFixed(3)}R (t ${s.last.t.toFixed(1)}, n ${s.last.n}, win ${percent(s.last.win)}); buys ${s.lastBuys.mean.toFixed(3)}R (n ${s.lastBuys.n}), sells ${s.lastSells.mean.toFixed(3)}R (n ${s.lastSells.n})`);
  out(`  all data: buys ${s.buys.mean.toFixed(3)}R (t ${s.buys.t.toFixed(1)}, n ${s.buys.n}), sells ${s.sells.mean.toFixed(3)}R (t ${s.sells.t.toFixed(1)}, n ${s.sells.n})`);
  out(`  controls after spread: shuffled candles ${control.mean.toFixed(3)}R (n ${control.n}); random entries same directions ${baseline.mean.toFixed(3)}R`);
}
writeFileSync(join(HERE, 'GOLD-RESULTS.txt'), `${lines.join('\n')}\n`);
process.exit(0);
