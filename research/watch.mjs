// Scans every market just after each 5m candle closes and prints one line per new event:
// SIGNAL (fresh BUY/SELL confirmed), AT LEVEL (price tapped a zone, waiting for confirmation) or ERROR.
// Each line is also appended to research/alerts.log. Run: node research/watch.mjs
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_SYMBOLS, formatPrice, scan } from './scanner.mjs';

const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), 'alerts.log');
const CANDLE_MS = 300_000;
const AFTER_CLOSE_MS = 20_000;
const seen = new Set();

function report(line) {
  const stamped = `${new Date().toISOString().slice(11, 16)}Z ${line}`;
  console.log(stamped);
  appendFileSync(LOG_FILE, `${stamped}\n`);
}

function eventOf({ instrument, signal }) {
  const price = (value) => formatPrice(instrument, value);
  const zone = signal.focus?.zone;
  if (signal.isFreshSignal) {
    const plan = signal.plan;
    return { key: `${instrument.symbol}|signal|${plan.entryTime}`,
      text: `SIGNAL ${instrument.shortName} ${signal.status} at ${price(plan.entry)} stop ${price(plan.initialStop)} target ${price(plan.target)} (${zone.model})` };
  }
  if (signal.focus?.status === 'tapped') {
    return { key: `${instrument.symbol}|tapped|${zone.direction}|${zone.level}`,
      text: `AT LEVEL ${instrument.shortName} ${zone.direction} ${zone.model} @ ${price(zone.level)}, price ${price(signal.lastClose)}: wait for 5m engulfing / pin bar / CHoCH` };
  }
  return null;
}

async function scanAll() {
  for (const symbol of ALL_SYMBOLS) {
    try {
      const event = eventOf(await scan(symbol));
      if (event && !seen.has(event.key)) {
        seen.add(event.key);
        report(event.text);
      }
    } catch (error) {
      const key = `${symbol}|error|${new Date().getUTCHours()}`;
      if (!seen.has(key)) { seen.add(key); report(`ERROR ${symbol}: ${error.message}`); }
    }
  }
}

report(`WATCHING ${ALL_SYMBOLS.length} markets every 5m`);
while (true) {
  await scanAll();
  const wait = CANDLE_MS - (Date.now() % CANDLE_MS) + AFTER_CLOSE_MS;
  await new Promise((resume) => setTimeout(resume, wait));
}
