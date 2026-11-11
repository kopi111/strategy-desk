// Prints the signal and checklist for each market.
// Run: node research/live-scan.mjs            (every market)
//      node research/live-scan.mjs R_25 R_75  (only these)
import { ALL_SYMBOLS, formatPrice, scan } from './scanner.mjs';

const requested = process.argv.slice(2);
for (const symbol of requested.length ? requested : ALL_SYMBOLS) {
  try {
    const { instrument, signal, lastCandle, source } = await scan(symbol);
    const price = (value) => formatPrice(instrument, value);
    const plan = signal.plan;
    console.log(`\n== ${instrument.shortName}  ${signal.status}  close ${price(signal.lastClose)}  (last 5m ${new Date(lastCandle * 1000).toISOString().slice(0, 16)}Z)  4H ${signal.biasTrend} · 1H ${signal.structureTrend} · ${source}`);
    console.log(`   ${signal.headline}`);
    if (signal.focus) console.log(`   zone: ${signal.focus.zone.model} ${signal.focus.zone.direction} @ ${price(signal.focus.zone.level)} [${signal.focus.status}] ${signal.focus.reason ?? ''}`);
    if (plan) console.log(`   plan (${plan.kind}): entry ${price(plan.entry)} stop ${price(plan.initialStop ?? plan.stop)} target ${price(plan.target)} RR ${plan.rewardToRisk?.toFixed?.(1) ?? '—'} ${plan.valid === false ? '(NOT VALID: ' + (plan.reason ?? '') + ')' : ''}`);
    for (const check of signal.checklist) console.log(`     [${check.result}] ${check.label}${check.detail ? ' — ' + check.detail : ''}`);
  } catch (error) {
    console.log(`\n== ${symbol}  ERROR ${error.message}`);
  }
}
