// This script scans kopi's Deriv markets with the APA rules and sends a Telegram alert only when a new trade opens.
// Run: node alerts/trade-alerts.mjs            (add --dry-run to print alerts instead of sending)
//      node alerts/trade-alerts.mjs R_75 R_100 (only these markets)
// Trades already sent are kept in SENT_FILE so the same trade is never sent twice.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { formatPrice, scan } from '../research/scanner.mjs';
import { CHAT_ID_KEY, TOKEN_KEY, TelegramBot, loadCredentials } from './telegram.mjs';

const DEFAULT_SYMBOLS = ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'frxXAUUSD'];
const SENT_FILE = process.env.SENT_FILE || new URL('./.sent-trades.json', import.meta.url).pathname;
const MAX_TRADE_AGE_SECONDS = 3 * 60 * 60;
const KEEP_SENT_SECONDS = 7 * 24 * 60 * 60;
const DRY_RUN = process.argv.includes('--dry-run');
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

await main();

// This function scans every market and sends an alert for each new trade.
async function main() {
  const sent = loadSent();
  const symbols = requested.length ? requested : DEFAULT_SYMBOLS;
  let alerts = 0;
  for (const symbol of symbols) {
    const trade = await newTrade(symbol, sent);
    if (!trade) continue;
    await deliver(trade.message);
    if (!DRY_RUN) sent[trade.key] = trade.entryTime;
    alerts += 1;
  }
  if (!DRY_RUN) saveSent(sent);
  console.log(`${new Date().toISOString()} scanned ${symbols.length} markets, ${alerts} new trade alert(s)`);
}

// This function returns the alert for a market's open trade, or nothing if there is no new trade.
async function newTrade(symbol, sent) {
  try {
    const { instrument, signal, simulationTrade } = await scanWithTrade(symbol);
    if (!simulationTrade) return undefined;
    const key = `${symbol}:${simulationTrade.id}`;
    const ageSeconds = Date.now() / 1000 - simulationTrade.entryTime;
    if (sent[key] || ageSeconds > MAX_TRADE_AGE_SECONDS) return undefined;
    return { key, entryTime: simulationTrade.entryTime, message: tradeMessage(instrument, signal, simulationTrade) };
  } catch (error) {
    console.log(`${symbol}: could not scan (${error.message})`);
    return undefined;
  }
}

// This function scans a market and picks out the open trade when the status is BUY or SELL.
async function scanWithTrade(symbol) {
  const result = await scan(symbol);
  const isTrade = result.signal.status === 'BUY' || result.signal.status === 'SELL';
  return { ...result, simulationTrade: isTrade ? result.signal.focus?.trade : undefined };
}

// This function writes the alert text for one trade.
function tradeMessage(instrument, signal, trade) {
  const price = (value) => formatPrice(instrument, value);
  const icon = signal.status === 'BUY' ? '🟢' : '🔴';
  const opened = new Date(trade.entryTime * 1000).toLocaleString('en-US', { timeZone: 'America/Jamaica', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const failed = signal.checklist.filter((check) => check.result === 'fail').map((check) => check.label);
  return [
    `${icon} ${signal.status} ${instrument.shortName} — Strategy Desk APA`,
    `Opened ${opened} (Jamaica) · ${trade.model} · ${trade.confirmation}`,
    `Entry ${price(trade.entry)} · Stop ${price(trade.stop)} · Target ${price(trade.target)} · RR ${trade.rewardToRisk?.toFixed?.(1) ?? '—'}`,
    `Price now ${price(signal.lastClose)} · 4H ${signal.biasTrend} / 1H ${signal.structureTrend}`,
    failed.length ? `⚠ Fails: ${failed.join(', ')}` : '',
    'Backtests found no edge on Vix (random markets). Small risk only. Chart: https://kopi111.github.io/strategy-desk/'
  ].filter(Boolean).join('\n');
}

// This function prints the alert on a dry run, otherwise sends it to the bot.
async function deliver(message) {
  if (DRY_RUN) {
    console.log(`${message}\n`);
    return;
  }
  const { token, chatId } = process.env[TOKEN_KEY] && process.env[CHAT_ID_KEY]
    ? { token: process.env[TOKEN_KEY], chatId: process.env[CHAT_ID_KEY] }
    : loadCredentials();
  await new TelegramBot(token).sendMessage(chatId, message);
}

// This function reads the list of trades already sent.
function loadSent() {
  return existsSync(SENT_FILE) ? JSON.parse(readFileSync(SENT_FILE, 'utf8')) : {};
}

// This function saves the sent list, dropping trades older than a week.
function saveSent(sent) {
  const cutoff = Date.now() / 1000 - KEEP_SENT_SECONDS;
  const kept = Object.fromEntries(Object.entries(sent).filter(([, entryTime]) => entryTime > cutoff));
  writeFileSync(SENT_FILE, JSON.stringify(kept, null, 2));
}
