// Downloads Deriv candles into data/<symbol>_<granularity>.csv (time,open,high,low,close).
// Run: node fetch.mjs <granularitySeconds> <fromYYYY-MM-DD> SYMBOL...
import { existsSync, writeFileSync } from 'node:fs';

const ENDPOINT = 'wss://api.derivws.com/trading/v1/options/ws/public?app_id=1089';
const PAGE = 5000;
const RETRIES = 6;
const [granularityArg, fromArg, ...symbols] = process.argv.slice(2);
const granularity = Number(granularityArg);
const from = Date.parse(fromArg) / 1000;

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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Deriv sometimes answers "an error occurred while processing your request"; reconnect and ask again.
async function requestWithRetry(state, payload) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request(state.socket, payload);
    } catch (error) {
      if (attempt === RETRIES) throw error;
      console.error(`retry ${attempt} after: ${error.message}`);
      state.socket.close();
      await pause(3000 * attempt);
      state.socket = await connect();
    }
  }
}

async function history(state, symbol) {
  const byTime = new Map();
  let end = 'latest';
  let previousEarliest = Infinity;
  while (true) {
    const { candles = [] } = await requestWithRetry(state, { ticks_history: symbol, style: 'candles', granularity, count: PAGE, end });
    for (const c of candles) if (c.epoch >= from) byTime.set(c.epoch, c);
    const earliest = candles[0]?.epoch;
    // Deriv keeps about one year; past that it returns a short page, then restarts from today.
    if (!earliest || earliest <= from || earliest >= previousEarliest || candles.length < PAGE) break;
    previousEarliest = earliest;
    end = earliest - 1;
  }
  return [...byTime.values()].sort((a, b) => a.epoch - b.epoch);
}

const state = { socket: await connect() };
for (const symbol of symbols) {
  if (existsSync(`data/${symbol}_${granularity}.csv`)) continue;
  const candles = await history(state, symbol);
  const rows = candles.map((c) => `${c.epoch},${c.open},${c.high},${c.low},${c.close}`);
  writeFileSync(`data/${symbol}_${granularity}.csv`, 'time,open,high,low,close\n' + rows.join('\n') + '\n');
  console.log(symbol, granularity, candles.length, new Date(candles[0].epoch * 1000).toISOString(), '→', new Date(candles.at(-1).epoch * 1000).toISOString());
}
state.socket.close();
