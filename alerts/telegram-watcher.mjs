// Keeps watching the markets with the Desk closed, using the Desk's own alert rules, and sends setups to Telegram.
// Run: node alerts/telegram-watcher.mjs            (needs node alerts/telegram-setup.mjs first)
//      node alerts/telegram-watcher.mjs --dry-run  (prints alerts here and sends nothing)
//      add --config <file> to use a different settings file
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore, loadScripts } from '../tests/load-core.mjs';
import { formatAlerts, HealthNotice, loadCredentials, Outbox, TelegramBot } from './telegram.mjs';

const CHECKS_PER_LOG_LINE = 20;
const DEFAULT_CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), 'telegram-alerts.json');

// Loads the same strategy code the browser runs, plus the live Deriv connection.
const APA = loadCore();
loadScripts(['js/data/deriv-feed.js', 'js/data/market-data.js']);
const settings = APA.settings.defaults();
const instruments = APA.settings.instruments(settings);

/** Reads the settings file and names the exact mistake if a market or timeframe is wrong. */
function readConfig(file) {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  for (const symbol of config.symbols) APA.instruments.bySymbol(instruments, symbol);
  APA.timeframes.byKey(config.timeframe);
  return config;
}

/** Re-reads the settings on every check, so edits apply without a restart. A broken edit keeps the last good settings. */
function configReader(file) {
  let lastGood = readConfig(file);
  return () => {
    try {
      lastGood = readConfig(file);
    } catch (error) {
      console.error(`Ignoring ${file}, using the last good settings: ${error.message}`);
    }
    return lastGood;
  };
}

/** Chooses where messages go: Telegram normally, or this terminal in a dry run. */
function messageSender(isDryRun) {
  if (isDryRun) return async (text) => console.log(`--- would send ---\n${text}`);
  const { token, chatId } = loadCredentials();
  const bot = new TelegramBot(token);
  return (text) => bot.sendMessage(chatId, text);
}

/** Connects the market feed. It connects when first used, so Deriv being down at startup is only a failed check. */
function liveMarket() {
  const market = new APA.MarketData(settings);
  const { derivEndpoint, derivAppId } = settings.data;
  market.use(new APA.DerivFeed({ endpoint: derivEndpoint, appId: derivAppId }), 'Live candles from Deriv.');
  return market;
}

/** Sends each market's new setups as one message, so a busy check does not hit Telegram's limits. */
function sendAlerts(alerts, outbox) {
  const { symbol, timeframe } = alerts[0];
  const instrument = APA.instruments.bySymbol(instruments, symbol);
  outbox.add(formatAlerts(alerts, {
    marketName: instrument.shortName,
    timeframeLabel: APA.timeframes.byKey(timeframe).label,
    formatPrice: (price) => APA.instruments.formatPrice(instrument, price),
  }));
  console.log(`${new Date().toISOString()} ${symbol} ${timeframe}: ${alerts.length} alert(s)`);
}

let checksDone = 0;

/** Reports each check round: retries unsent messages and warns the phone if Deriv keeps failing. */
function handleStatus(status, outbox, health) {
  // A log line for the first check and about every 10 minutes after, so the service log shows it is alive.
  if (checksDone++ % CHECKS_PER_LOG_LINE === 0) console.log(`${new Date().toISOString()} check ${checksDone}: ${status.marketCount} market(s), ${status.failures.length} failed`);
  const nameOf = (symbol) => APA.instruments.bySymbol(instruments, symbol).shortName;
  const notice = health.update(status, nameOf);
  if (notice) outbox.add(notice); else outbox.flush();
  if (status.failures.length) console.warn(`${new Date().toISOString()} failed: ${status.failures.map((failure) => `${failure.symbol} (${failure.message})`).join(', ')}`);
}

/** Starts everything and announces it, so the phone confirms the watcher is really running. */
function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const getConfig = configReader(configIndex >= 0 ? args[configIndex + 1] : DEFAULT_CONFIG_FILE);
  const outbox = new Outbox(messageSender(args.includes('--dry-run')));
  const health = new HealthNotice();
  const watcher = new APA.AlertWatcher({
    market: liveMarket(),
    getConfig,
    onAlerts: (alerts) => sendAlerts(alerts, outbox),
    onStatus: (status) => handleStatus(status, outbox, health),
  });
  const { symbols, timeframe } = getConfig();
  outbox.add(`Phone alerts started: ${symbols.map((symbol) => APA.instruments.bySymbol(instruments, symbol).shortName).join(', ')} on ${APA.timeframes.byKey(timeframe).label}.`);
  watcher.start();
}

main();
