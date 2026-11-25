// Downloads Deriv candle history (as far back as Deriv keeps, about one year) (5m, 1H, 4H) into research/backtest-3y/deriv/<symbol>_<seconds>.json.
// Uses Deriv's new public feed; the old ws/red.derivws.com addresses return HTTP 520 since 2026-11-24.
// Run: node research/backtest-3y/fetch-deriv.mjs R_25 R_75 R_100 stpRNG2
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'deriv');
const FROM = Date.UTC(2023, 9, 1) / 1000;
const GRANULARITIES = [300, 3600, 14400];
const PAGE = 5000;

function connect() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(ENDPOINT);
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error(`Cannot reach ${ENDPOINT}`));
  });
}

function request(socket, payload) {
  return new Promise((resolve, reject) => {
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data);
    };
    socket.send(JSON.stringify(payload));
  });
}

async function history(socket, symbol, granularity) {
  const byTime = new Map();
  let end = 'latest';
  let previousEarliest = Infinity;
  while (true) {
    const { candles = [] } = await request(socket, { ticks_history: symbol, style: 'candles', granularity, count: PAGE, end });
    for (const { epoch, open, high, low, close } of candles) byTime.set(epoch, { time: epoch, open: +open, high: +high, low: +low, close: +close });
    const earliest = candles[0]?.epoch;
    // Deriv keeps about one year of candles; past that it returns a short page, then starts again from today.
    if (!earliest || earliest <= FROM || earliest >= previousEarliest || candles.length < PAGE) break;
    previousEarliest = earliest;
    end = earliest - 1;
    if (process.env.VERBOSE) console.log(symbol, granularity, candles.length, new Date(earliest * 1000).toISOString());
  }
  return [...byTime.values()].filter((candle) => candle.time >= FROM).sort((first, second) => first.time - second.time);
}

mkdirSync(OUT_DIR, { recursive: true });
const socket = await connect();
for (const symbol of process.argv.slice(2)) {
  for (const granularity of GRANULARITIES) {
    const candles = await history(socket, symbol, granularity);
    writeFileSync(join(OUT_DIR, `${symbol}_${granularity}.json`), JSON.stringify(candles));
    console.log(`${symbol} ${granularity}s: ${candles.length} candles ${new Date(candles[0].time * 1000).toISOString().slice(0, 10)} → ${new Date(candles.at(-1).time * 1000).toISOString().slice(0, 16)}`);
  }
}
socket.close();
