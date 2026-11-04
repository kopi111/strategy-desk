// Searches for strategies that win over 55% of trades AND make money after spread, judged on data they were not picked on.
// Run: node --max-old-space-size=8000 research/strategy-search/search.mjs
// Every rule is chosen using only the first 70% of each market's history. The last 30% then decides whether it held up.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPREAD_SHARE as VIX_SPREADS, averageRanges, randomSource, readCandles, runTrade, shuffledCandles } from '../fvg-return/study.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APA = globalThis.APA;
const M1 = join(HERE, '..', 'backtest-3y', 'm1');
const HISTDATA_UTC_OFFSET_SECONDS = 5 * 3600;
const TIMEFRAMES = [['5m', 300], ['15m', 900], ['1h', 3600]];
const VIX_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
// Assumed spreads as a share of price, from the Desk's instrument list.
const REAL_MARKETS = { XAUUSD: 0.3 / 3000, EURUSD: 0.00012 / 1.1, GBPUSD: 0.00012 / 1.3, AUDUSD: 0.00012 / 0.68, NZDUSD: 0.00012 / 0.6, USDJPY: 0.012 / 150, USDCAD: 0.00012 / 1.37, USDCHF: 0.00012 / 0.85 };
const STOP_RANGES = [1, 2];
const TARGET_RATIOS = [0.5, 0.75, 1, 1.5];
const MAX_BARS = 200;
const FIRST_PART = 0.7;
const WANTED_WIN = 0.55;
const TREND_EMA = 200;
const FINALISTS = 8;
const lines = [];
const out = (text = '') => { console.log(text); lines.push(text); };
const percent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '-');

// ---------- indicators, each worked out in one pass from closed candles only ----------

/** Exponential moving average of the closes. */
function emaOf(list, period) {
  const k = 2 / (period + 1);
  const values = new Array(list.length);
  let current = list[0].close;
  for (let i = 0; i < list.length; i++) { current = list[i].close * k + current * (1 - k); values[i] = current; }
  return values;
}

/** Wilder's RSI of the closes. */
function rsiOf(list, period) {
  const values = new Array(list.length).fill(50);
  let gain = 0; let loss = 0;
  for (let i = 1; i < list.length; i++) {
    const change = list[i].close - list[i - 1].close;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    values[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return values;
}

// ---------- classic strategies: each returns a list of { index, buying }, decided when candle `index` closes ----------

/** Short-term dip buying: RSI(2) very low means buy, very high means sell. */
function rsiTwo(list) {
  const rsi = rsiOf(list, 2); const signals = [];
  for (let i = 5; i < list.length; i++) { if (rsi[i] < 10) signals.push({ index: i, buying: true }); else if (rsi[i] > 90) signals.push({ index: i, buying: false }); }
  return signals;
}

/** Close outside 2 standard deviations of the 20-candle average: trade back towards the average. */
function bollingerFade(list) {
  const signals = [];
  for (let i = 20; i < list.length; i++) {
    const closes = list.slice(i - 19, i + 1).map((c) => c.close);
    const mean = closes.reduce((a, b) => a + b, 0) / 20;
    const deviation = Math.sqrt(closes.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
    if (list[i].close < mean - 2 * deviation) signals.push({ index: i, buying: true });
    else if (list[i].close > mean + 2 * deviation) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** In an EMA 20/50 trend, price dips through the EMA 20 and closes back on the trend side. */
function emaPullback(list) {
  const fast = emaOf(list, 20); const slow = emaOf(list, 50); const signals = [];
  for (let i = 50; i < list.length; i++) {
    if (fast[i] > slow[i] && list[i].low < fast[i] && list[i].close > fast[i]) signals.push({ index: i, buying: true });
    else if (fast[i] < slow[i] && list[i].high > fast[i] && list[i].close < fast[i]) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** A close beyond the highest high or lowest low of the last 20 candles. */
function donchianBreakout(list) {
  const signals = [];
  for (let i = 20; i < list.length; i++) {
    const window = list.slice(i - 20, i);
    if (list[i].close > Math.max(...window.map((c) => c.high))) signals.push({ index: i, buying: true });
    else if (list[i].close < Math.min(...window.map((c) => c.low))) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** After an inside candle, a close beyond the larger candle before it. */
function insideBarBreakout(list) {
  const signals = [];
  for (let i = 2; i < list.length; i++) {
    if (!APA.candles.isInsideBar(list[i - 2], list[i - 1])) continue;
    if (list[i].close > list[i - 2].high) signals.push({ index: i, buying: true });
    else if (list[i].close < list[i - 2].low) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** An engulfing candle. */
function engulfing(list) {
  const signals = [];
  for (let i = 1; i < list.length; i++) {
    if (APA.candles.isBullishEngulfing(list[i - 1], list[i])) signals.push({ index: i, buying: true });
    else if (APA.candles.isBearishEngulfing(list[i - 1], list[i])) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** A pin bar. */
function pinBar(list) {
  const signals = [];
  for (let i = 0; i < list.length; i++) {
    if (APA.candles.isBullishPinBar(list[i])) signals.push({ index: i, buying: true });
    else if (APA.candles.isBearishPinBar(list[i])) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** Three closes in a row the same way: trade the other way. */
function threeInARow(list) {
  const signals = [];
  for (let i = 3; i < list.length; i++) {
    const falling = list[i].close < list[i - 1].close && list[i - 1].close < list[i - 2].close && list[i - 2].close < list[i - 3].close;
    const rising = list[i].close > list[i - 1].close && list[i - 1].close > list[i - 2].close && list[i - 2].close > list[i - 3].close;
    if (falling) signals.push({ index: i, buying: true }); else if (rising) signals.push({ index: i, buying: false });
  }
  return signals;
}

/** The first close beyond the 07:00 to 08:00 UTC range each day. */
function londonBreakout(list) {
  const signals = []; let day = null; let top = -Infinity; let bottom = Infinity; let isDone = false;
  for (let i = 0; i < list.length; i++) {
    const date = new Date(list[i].time * 1000);
    if (date.getUTCDate() !== day) { day = date.getUTCDate(); top = -Infinity; bottom = Infinity; isDone = false; }
    const hour = date.getUTCHours();
    if (hour === 7) { top = Math.max(top, list[i].high); bottom = Math.min(bottom, list[i].low); continue; }
    if (isDone || hour < 8 || hour > 16 || top === -Infinity) continue;
    if (list[i].close > top) { signals.push({ index: i, buying: true }); isDone = true; }
    else if (list[i].close < bottom) { signals.push({ index: i, buying: false }); isDone = true; }
  }
  return signals;
}

const CLASSIC = [['RSI(2) dip', rsiTwo], ['Bollinger fade', bollingerFade], ['EMA pullback', emaPullback], ['20-candle breakout', donchianBreakout], ['Inside bar breakout', insideBarBreakout], ['Engulfing', engulfing], ['Pin bar', pinBar], ['3 in a row, fade', threeInARow], ['London breakout', londonBreakout]];

/** Collects every strategy's signals for one candle list, including the Desk's own setups exactly as it alerts on them. */
function allSignals(list, seconds) {
  const signals = new Map(CLASSIC.map(([name, find]) => [name, find(list)]));
  const analysis = APA.smartMoney.analyze(list, { timeframeSeconds: seconds });
  for (const concept of APA.smartMoney.concepts) {
    signals.set(concept.name, analysis.events.filter((event) => event.concept === concept.id).map((event) => ({ index: event.index, buying: event.direction === 'buy' })));
  }
  return signals;
}

/** Plays signals forward, one trade at a time, entering at the next candle's open. Trades can only start after the last one ended. */
function play(list, signals, averages, trend, { stopRanges, ratio, useTrend }, spreadShare) {
  const trades = [];
  let freeFrom = 0;
  for (const { index, buying } of signals) {
    const entryIndex = index + 1;
    if (entryIndex < freeFrom || entryIndex >= list.length || index < 50) continue;
    if (useTrend && (buying ? list[index].close <= trend[index] : list[index].close >= trend[index])) continue;
    const entry = list[entryIndex].open;
    const risk = averages[index] * stopRanges;
    if (risk <= 0) continue;
    const trade = runTrade(list, { entryIndex, entry, buying, stop: buying ? entry - risk : entry + risk, target: buying ? entry + risk * ratio : entry - risk * ratio, maxBars: MAX_BARS, enteredAtOpen: true }, spreadShare);
    if (trade) { trades.push(trade); freeFrom = trade.exitIndex + 1; }
  }
  return trades;
}

/** A running total, so results pool across markets without keeping every trade in memory. */
const newTotals = () => ({ n: 0, wins: 0, net: 0, netSquared: 0, gross: 0, buysNet: 0, buysN: 0, sellsNet: 0, sellsN: 0 });
function addTrade(totals, trade) {
  totals.n++; if (trade.netR > 0) totals.wins++;
  totals.net += trade.netR; totals.netSquared += trade.netR ** 2; totals.gross += trade.grossR;
  if (trade.buying) { totals.buysNet += trade.netR; totals.buysN++; } else { totals.sellsNet += trade.netR; totals.sellsN++; }
}
const stats = (totals) => {
  const mean = totals.net / totals.n;
  const variance = totals.netSquared / totals.n - mean ** 2;
  return { n: totals.n, win: totals.wins / totals.n, mean, gross: totals.gross / totals.n, t: mean / Math.sqrt(variance / totals.n), buys: totals.buysNet / totals.buysN, sells: totals.sellsNet / totals.sellsN };
};

/** Reads one market's 1-minute files and builds its candles. */
function readRealMarket(symbol) {
  const minutes = [];
  for (const name of readdirSync(M1).filter((file) => file.includes(`_${symbol}_`)).sort()) {
    for (const line of readFileSync(join(M1, name), 'utf8').trim().split('\n')) {
      const [stamp, open, high, low, close] = line.split(';');
      minutes.push({ time: Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(9, 11), +stamp.slice(11, 13)) / 1000 + HISTDATA_UTC_OFFSET_SECONDS, open: +open, high: +high, low: +low, close: +close });
    }
  }
  return minutes;
}

/** Runs every rule on one candle list and adds the results to the group's totals. */
function runAllRules(group, symbol, label, list, seconds, spreadShare, results) {
  const averages = averageRanges(list);
  const trend = emaOf(list, TREND_EMA);
  const cut = Math.floor(list.length * FIRST_PART);
  const signals = allSignals(list, seconds);
  for (const [strategy, found] of signals) {
    for (const stopRanges of STOP_RANGES) for (const ratio of TARGET_RATIOS) for (const useTrend of [false, true]) {
      const key = `${group}|${label}|${strategy}|${stopRanges}|${ratio}|${useTrend}`;
      if (!results.has(key)) results.set(key, { group, label, strategy, stopRanges, ratio, useTrend, first: newTotals(), last: newTotals(), byMarket: new Map() });
      const row = results.get(key);
      let marketNet = 0;
      for (const trade of play(list, found, averages, trend, { stopRanges, ratio, useTrend }, spreadShare)) {
        addTrade(trade.index < cut ? row.first : row.last, trade);
        marketNet += trade.netR;
      }
      row.byMarket.set(symbol, marketNet);
    }
  }
}

/** Pure random walk candles: no strategy can have an edge here, so this exposes any flaw in the test itself. */
function randomWalk(bars, random) {
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const list = []; let price = 100000;
  for (let bar = 0; bar < bars; bar++) {
    const open = price; let high = price; let low = price;
    for (let tick = 0; tick < 60; tick++) { price += gaussian(); high = Math.max(high, price); low = Math.min(low, price); }
    list.push({ time: 1700000000 + bar * 900, open, high, low, close: price });
  }
  return list;
}

// ---------- step 1: prove the test is fair on random data ----------
out('===== STEP 1: FAIRNESS CHECK ON A PURE RANDOM WALK (no spread) =====');
const walkResults = new Map();
runAllRules('walk', 'walk', '15m', randomWalk(60000, randomSource(11)), 900, 0, walkResults);
const walkRows = [...walkResults.values()].filter((r) => r.first.n + r.last.n >= 300).map((r) => {
  const all = newTotals(); for (const part of [r.first, r.last]) for (const key of Object.keys(all)) all[key] += part[key];
  return { ...r, all: stats(all) };
});
const falseWins = walkRows.filter((r) => r.all.win > 1 / (1 + r.ratio) + 0.03 && r.all.t > 3).length;
const worstT = Math.max(...walkRows.map((r) => r.all.t));
const averageGross = walkRows.reduce((sum, r) => sum + r.all.gross, 0) / walkRows.length;
out(`${walkRows.length} rules. Average result ${averageGross.toFixed(4)}R (fair is 0). Highest t ${worstT.toFixed(1)}. Rules beating coin-flip odds with t above 3: ${falseWins}.`);
const walkAtRatio = TARGET_RATIOS.map((ratio) => { const rows = walkRows.filter((r) => r.ratio === ratio); return `${ratio}R target: ${percent(rows.reduce((s, r) => s + r.all.win, 0) / rows.length)} (fair ${percent(1 / (1 + ratio))})`; });
out(`Average win rate on random data: ${walkAtRatio.join(' | ')}`);

// ---------- step 2: run every rule on every market ----------
const results = new Map();
const candleStore = new Map();
for (const symbol of Object.keys(REAL_MARKETS)) {
  const minutes = readRealMarket(symbol);
  const group = symbol === 'XAUUSD' ? 'Gold' : 'Forex';
  for (const [label, seconds] of TIMEFRAMES) {
    const list = APA.candles.resample(minutes, seconds);
    candleStore.set(`${symbol}|${label}`, list);
    runAllRules(group, symbol, label, list, seconds, REAL_MARKETS[symbol], results);
  }
  console.log(`done ${symbol}`);
}
for (const symbol of VIX_MARKETS) {
  for (const [label, seconds] of TIMEFRAMES) {
    const list = readCandles(symbol, label);
    candleStore.set(`${symbol}|${label}`, list);
    runAllRules('Vix', symbol, label, list, seconds, VIX_SPREADS[symbol], results);
  }
  console.log(`done ${symbol}`);
}

// ---------- step 3: pick on the first 70% only, then judge on the last 30% ----------
const describe = (r) => `${r.label.padEnd(4)}${r.strategy.padEnd(26)} stop ${r.stopRanges} range, target ${String(r.ratio).padEnd(4)}R${r.useTrend ? ', with EMA200' : ''}`;
const rows = [...results.values()].filter((r) => r.first.n >= 100 && r.last.n >= 30).map((r) => ({ ...r, firstStats: stats(r.first), lastStats: stats(r.last) }));
out(`\n${rows.length} rule and market-group combinations with enough trades.`);
for (const group of ['Gold', 'Forex', 'Vix']) {
  const groupRows = rows.filter((r) => r.group === group);
  const qualified = groupRows.filter((r) => r.firstStats.win >= WANTED_WIN && r.firstStats.mean > 0);
  const held = qualified.filter((r) => r.lastStats.win >= WANTED_WIN && r.lastStats.mean > 0);
  const anyProfit = groupRows.filter((r) => r.firstStats.mean > 0 && r.lastStats.mean > 0).length;
  out(`\n===== ${group}: ${groupRows.length} rules =====`);
  out(`Win 55%+ on the first 70% (any profit): ${groupRows.filter((r) => r.firstStats.win >= WANTED_WIN).length}. Win 55%+ AND profit on the first 70%: ${qualified.length}. Of those, still both on the unseen 30%: ${held.length}. Profit on both parts at any win rate: ${anyProfit}.`);
  out('Finalists, picked on the first 70% by t-score:');
  for (const r of [...qualified].sort((one, two) => two.firstStats.t - one.firstStats.t).slice(0, FINALISTS)) {
    out(`  ${describe(r)} | first 70%: win ${percent(r.firstStats.win)}, ${r.firstStats.mean.toFixed(3)}R, t ${r.firstStats.t.toFixed(1)}, n ${r.firstStats.n} | UNSEEN: win ${percent(r.lastStats.win)}, ${r.lastStats.mean.toFixed(3)}R, t ${r.lastStats.t.toFixed(1)}, n ${r.lastStats.n}, buys ${r.lastStats.buys.toFixed(3)}, sells ${r.lastStats.sells.toFixed(3)}`);
  }
}

// ---------- step 4: everything that passed both parts, tested on shuffled candles, and gold on older prices ----------
out('\n===== STEP 4: RULES THAT WON 55%+ AND PROFITED ON BOTH PARTS, AGAINST CONTROLS =====');
const passed = rows.filter((r) => r.firstStats.win >= WANTED_WIN && r.firstStats.mean > 0 && r.lastStats.win >= WANTED_WIN && r.lastStats.mean > 0)
  .sort((one, two) => two.lastStats.t - one.lastStats.t);
out(`${passed.length} passed.`);
const random = randomSource(2026);
const spreadOf = (symbol) => REAL_MARKETS[symbol] ?? VIX_SPREADS[symbol];
for (const r of passed.slice(0, 20)) {
  const shuffledTotals = newTotals();
  for (const symbol of r.byMarket.keys()) {
    const mixed = shuffledCandles(candleStore.get(`${symbol}|${r.label}`), random);
    const seconds = TIMEFRAMES.find(([label]) => label === r.label)[1];
    for (const trade of play(mixed, allSignals(mixed, seconds).get(r.strategy), averageRanges(mixed), emaOf(mixed, TREND_EMA), r, spreadOf(symbol))) addTrade(shuffledTotals, trade);
  }
  const control = stats(shuffledTotals);
  const marketsUp = [...r.byMarket.values()].filter((value) => value > 0).length;
  out(`${r.group.padEnd(6)}${describe(r)} | first ${percent(r.firstStats.win)} ${r.firstStats.mean.toFixed(3)}R t ${r.firstStats.t.toFixed(1)} | unseen ${percent(r.lastStats.win)} ${r.lastStats.mean.toFixed(3)}R t ${r.lastStats.t.toFixed(1)} n ${r.lastStats.n} | markets up ${marketsUp}/${r.byMarket.size} | shuffled ${percent(control.win)} ${control.mean.toFixed(3)}R`);
}

// Older gold, 2016 to 2022, was not used anywhere above, so it is a true outside test for the gold 1H rules.
const older = readFileSync(join(HERE, '..', '..', '..', 'deriv_signal_app', 'research', 'cache', 'long', 'xauusd.csv'), 'utf8').trim().split('\n').slice(1).map((line) => {
  const [stamp, open, high, low, close] = line.split(',');
  return { time: Math.floor(+stamp / 1000), open: +open, high: +high, low: +low, close: +close };
}).filter((candle) => candle.time < Date.UTC(2023, 0, 1) / 1000);
out(`\n===== GOLD 1H RULES ON OLDER PRICES (${new Date(older[0].time * 1000).toISOString().slice(0, 10)} to ${new Date(older.at(-1).time * 1000).toISOString().slice(0, 10)}, ${older.length} candles) =====`);
const olderSignals = allSignals(older, 3600);
const olderAverages = averageRanges(older);
const olderTrend = emaOf(older, TREND_EMA);
const goldHour = rows.filter((r) => r.group === 'Gold' && r.label === '1h');
const profitableLeads = goldHour.filter((r) => r.firstStats.mean > 0 && r.lastStats.mean > 0).sort((one, two) => two.firstStats.t - one.firstStats.t).slice(0, 12);
// Every rule that met the 55% goal goes first: those are the rules this search exists to find.
const goldLeads = [...new Set([...passed.filter((r) => r.group === 'Gold' && r.label === '1h'), ...profitableLeads])];
for (const r of goldLeads) {
  const totals = newTotals();
  for (const trade of play(older, olderSignals.get(r.strategy), olderAverages, olderTrend, r, REAL_MARKETS.XAUUSD)) addTrade(totals, trade);
  const old = stats(totals);
  out(`${describe(r)} | 2023-26: win ${percent(r.firstStats.win)}/${percent(r.lastStats.win)} ${r.firstStats.mean.toFixed(3)}/${r.lastStats.mean.toFixed(3)}R | 2016-22: win ${percent(old.win)}, ${old.mean.toFixed(3)}R, t ${old.t.toFixed(1)}, n ${old.n}, buys ${old.buys.toFixed(3)}, sells ${old.sells.toFixed(3)}`);
}
writeFileSync(join(HERE, 'RESULTS.txt'), `${lines.join('\n')}\n`);
console.log('SEARCH DONE');
process.exit(0);
