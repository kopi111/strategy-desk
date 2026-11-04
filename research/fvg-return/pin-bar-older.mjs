// One-shot outside test of the best gold lead, with its rule unchanged: 1H, London and New York hours, pin bar after an FVG touch, candle stop, 3R.
// Run: node research/fvg-return/pin-bar-older.mjs
// The rule was chosen on 2023-2026 prices. These 2016-2022 prices played no part in choosing it.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomSource, shuffledCandles, simulate, summarize } from './study.mjs';
import { CONFIRMATIONS, confirmationRule } from './confirmation-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECONDS = 3600;
const SPREAD_SHARE = 0.3 / 3000;
const [, isPinBar, needsTrend] = CONFIRMATIONS.find(([name]) => name === 'pin bar');
const lines = [];
const out = (text = '') => { console.log(text); lines.push(text); };
const percent = (value) => `${(value * 100).toFixed(1)}%`;

/** Reads hourly gold from before 2023. */
const older = readFileSync(join(HERE, '..', '..', '..', 'deriv_signal_app', 'research', 'cache', 'long', 'xauusd.csv'), 'utf8').trim().split('\n').slice(1).map((line) => {
  const [stamp, open, high, low, close] = line.split(',');
  return { time: Math.floor(+stamp / 1000), open: +open, high: +high, low: +low, close: +close };
}).filter((candle) => candle.time < Date.UTC(2023, 0, 1) / 1000);

const inSession = (time) => { const hour = new Date(time * 1000).getUTCHours(); return hour >= 7 && hour < 17; };
const isBackToBack = (list, index) => index >= 2 && list[index].time - list[index - 2].time === 2 * SECONDS;

/** The same rule as the gold study: real gaps only, entries in London and New York hours only. */
const rule = (target) => {
  const inner = confirmationRule(isPinBar, needsTrend, 'candle', target, []);
  return (list, gap, average) => {
    if (!isBackToBack(list, gap.index)) return null;
    const plan = inner(list, gap, average);
    return plan && inSession(list[plan.entryIndex].time) ? plan : null;
  };
};
const describe = (s) => `${String(s.n).padStart(4)} trades, win ${percent(s.win)}, ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)}R after spread, t ${s.t.toFixed(1)}`;

out(`Gold 1H ${new Date(older[0].time * 1000).toISOString().slice(0, 10)} to ${new Date(older.at(-1).time * 1000).toISOString().slice(0, 10)}, ${older.length} candles, price ${older[0].open} to ${older.at(-1).close}`);
for (const target of [3, 2, 1]) {
  const trades = simulate(older, SPREAD_SHARE, rule(target));
  const all = summarize(trades.map((t) => t.netR));
  out(`\n${target}R target${target === 3 ? ' (THE RULE BEING TESTED)' : ' (for context)'}: ${describe(all)}; before spread ${summarize(trades.map((t) => t.grossR)).mean.toFixed(3)}R`);
  out(`  buys:  ${describe(summarize(trades.filter((t) => t.buying).map((t) => t.netR)))}`);
  out(`  sells: ${describe(summarize(trades.filter((t) => !t.buying).map((t) => t.netR)))}`);
  if (target !== 3) continue;
  for (let year = 2016; year <= 2022; year++) {
    const inYear = trades.filter((t) => new Date(older[t.index].time * 1000).getUTCFullYear() === year);
    out(`  ${year}: ${describe(summarize(inYear.map((t) => t.netR)))}, total ${inYear.reduce((sum, t) => sum + t.netR, 0).toFixed(1)}R`);
  }
  let peak = 0; let total = 0; let worst = 0; let streak = 0; let longest = 0;
  for (const t of trades) { total += t.netR; peak = Math.max(peak, total); worst = Math.min(worst, total - peak); streak = t.netR > 0 ? 0 : streak + 1; longest = Math.max(longest, streak); }
  out(`  total ${total.toFixed(1)}R, worst drop ${worst.toFixed(1)}R, longest losing streak ${longest}`);
  const random = randomSource(316);
  const control = [];
  for (let run = 0; run < 20; run++) control.push(...simulate(shuffledCandles(older, random), SPREAD_SHARE, rule(target)).map((t) => t.netR));
  out(`  shuffled candles, 20 runs: ${describe(summarize(control))}`);
}
writeFileSync(join(HERE, 'PIN-BAR-OLDER-RESULTS.txt'), `${lines.join('\n')}\n`);
process.exit(0);
