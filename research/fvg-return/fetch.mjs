// Downloads Volatility index candles from Deriv's public API into data/, one request at a time.
// Run: node research/fvg-return/fetch.mjs               (the ten markets of the study, all timeframes)
//      node research/fvg-return/fetch.mjs 15m R_15 R_30  (only the named timeframe and markets)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
const [ONLY_TIMEFRAME, ...ONLY_MARKETS] = process.argv.slice(2);
const MARKETS = ONLY_MARKETS.length ? ONLY_MARKETS : ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
const TIMEFRAMES = [{ label: '5m', seconds: 300, days: 370 }, { label: '15m', seconds: 900, days: 370 }, { label: '1h', seconds: 3600, days: 370 }].filter(({ label }) => !ONLY_TIMEFRAME || label === ONLY_TIMEFRAME);
const PAGE = 5000;
const REQUESTS_PER_CONNECTION = 150;
const RETRIES = 5;
const ENDPOINTS = ['wss://red.derivws.com/websockets/v3?app_id=1089', 'wss://red.binaryws.com/websockets/v3?app_id=1089'];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let socket = null;
let requestsOnSocket = 0;

// Opens a connection, trying each Deriv address until one answers.
async function connect() {
  for (const url of ENDPOINTS) {
    try {
      socket = await new Promise((resolve, reject) => {
        const candidate = new WebSocket(url);
        candidate.onopen = () => resolve(candidate);
        candidate.onerror = () => reject(new Error(`could not open ${url}`));
      });
      requestsOnSocket = 0;
      return;
    } catch (error) { console.warn(error.message); }
  }
  throw new Error('No Deriv address answered.');
}

// Sends one request and waits for the answer, with a time limit.
async function ask(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN || requestsOnSocket >= REQUESTS_PER_CONNECTION) { if (socket) socket.close(); await connect(); }
  requestsOnSocket++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), 30000);
    socket.onmessage = (message) => { clearTimeout(timer); const answer = JSON.parse(message.data); answer.error ? reject(new Error(answer.error.message)) : resolve(answer); };
    socket.onclose = () => { clearTimeout(timer); reject(new Error('connection closed')); };
    socket.send(JSON.stringify(payload));
  });
}

// Retries a page, because Deriv sometimes answers with a one-off error or a rate limit.
async function page(symbol, seconds, end) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ask({ ticks_history: symbol, style: 'candles', granularity: seconds, count: PAGE, end });
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      console.warn(`  ${symbol} ${seconds}s retry ${attempt}: ${error.message}`);
      await pause(5000 * attempt);
    }
  }
}

// Pages backwards. Deriv restarts from the latest candle past its history limit, so anything not older is discarded.
async function download(symbol, seconds, days) {
  const oldest = Math.floor(Date.now() / 1000) - days * 86400;
  let collected = [];
  let end = 'latest';
  while (true) {
    const answer = await page(symbol, seconds, end);
    const batch = (answer.candles || []).filter((candle) => !collected.length || candle.epoch < collected[0].epoch);
    if (!batch.length) break;
    collected = batch.concat(collected);
    if (batch.length < PAGE / 2 || batch[0].epoch <= oldest) break;
    end = String(batch[0].epoch - 1);
    await pause(250);
  }
  return collected.filter((candle) => candle.epoch >= oldest);
}

mkdirSync(DATA, { recursive: true });
for (const { label, seconds, days } of TIMEFRAMES) {
  for (const symbol of MARKETS) {
    const file = join(DATA, `${symbol}_${label}.csv`);
    if (existsSync(file)) { console.log(`have ${symbol} ${label}`); continue; }
    const candles = await download(symbol, seconds, days);
    // The newest candle may still be forming, so it is dropped.
    const rows = candles.slice(0, -1).map((c) => `${c.epoch},${c.open},${c.high},${c.low},${c.close}`);
    writeFileSync(file, `time,open,high,low,close\n${rows.join('\n')}\n`);
    console.log(`${symbol} ${label}: ${rows.length} candles, ${((candles.at(-1).epoch - candles[0].epoch) / 86400).toFixed(0)} days`);
  }
}
console.log('FETCH DONE');
process.exit(0);
