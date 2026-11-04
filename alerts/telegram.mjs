// The Telegram side of the phone alerts: reading and saving credentials, sending messages and wording them.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CREDENTIALS_FILE = join(homedir(), '.credentials', 'all-projects.env');
export const TOKEN_KEY = 'STRATEGY_DESK_TELEGRAM_BOT_TOKEN';
export const CHAT_ID_KEY = 'STRATEGY_DESK_TELEGRAM_CHAT_ID';

const SECTION_HEADING = '# ===== Strategy Desk phone alerts (~/projects/strategy-desk/alerts) =====';
const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_RATE_LIMIT_RETRIES = 3;
const OUTBOX_LIMIT = 50;
const CHECKS_BEFORE_WARNING = 20;
const LOCAL_TIME_ZONE = 'America/Jamaica';

const localTime = new Intl.DateTimeFormat('en-US', { timeZone: LOCAL_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Reads KEY=value lines from the credentials text. Comments and blank lines are skipped. */
export function parseCredentials(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

/** Sets the token and chat id in the credentials text, and leaves every other project's lines untouched. */
export function withTelegramCredentials(text, token, chatId) {
  const otherLines = text.split('\n').filter((line) => !line.startsWith(`${TOKEN_KEY}=`) && !line.startsWith(`${CHAT_ID_KEY}=`) && line !== SECTION_HEADING);
  const body = otherLines.join('\n').trimEnd();
  return `${body}\n\n${SECTION_HEADING}\n${TOKEN_KEY}=${token}\n${CHAT_ID_KEY}=${chatId}\n`;
}

/** Saves the credentials and keeps the file readable only by this user. */
export function saveCredentials(token, chatId, file = CREDENTIALS_FILE) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, withTelegramCredentials(current, token, chatId), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Loads the saved token and chat id, or explains which step is missing. */
export function loadCredentials(file = CREDENTIALS_FILE) {
  const values = existsSync(file) ? parseCredentials(readFileSync(file, 'utf8')) : {};
  if (!values[TOKEN_KEY] || !values[CHAT_ID_KEY]) throw new Error(`No Telegram bot saved in ${file}. Run: node alerts/telegram-setup.mjs`);
  return { token: values[TOKEN_KEY], chatId: values[CHAT_ID_KEY] };
}

/** Talks to the Telegram Bot API. Error messages never include the token, because it is part of the web address. */
export class TelegramBot {
  constructor(token, { fetchImpl = globalThis.fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.wait = wait;
  }

  /** Calls one API method. If Telegram says "slow down", it waits as long as asked and tries again. */
  async call(method, payload = {}) {
    for (let attempt = 0; ; attempt++) {
      const answer = await this.post(method, payload);
      if (answer.ok) return answer.result;
      const retryAfter = answer.parameters && answer.parameters.retry_after;
      if (!retryAfter || attempt >= MAX_RATE_LIMIT_RETRIES) throw new Error(`Telegram refused ${method}: ${answer.description || 'no reason given'}`);
      await this.wait(retryAfter * 1000);
    }
  }

  /** Sends the web request. A network failure is reported without the web address. */
  async post(method, payload) {
    let response;
    try {
      response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
    } catch {
      throw new Error(`Could not reach Telegram for ${method}.`);
    }
    return response.json();
  }

  /** Sends plain text. Telegram then confirms delivery, or this throws. */
  sendMessage(chatId, text) {
    return this.call('sendMessage', { chat_id: chatId, text: text.slice(0, TELEGRAM_MESSAGE_LIMIT) });
  }
}

/** Holds messages until Telegram confirms them, so a short network drop does not lose an alert. */
export class Outbox {
  constructor(deliver, log = console.log) {
    this.deliver = deliver;
    this.log = log;
    this.waiting = [];
    this.isFlushing = false;
  }

  /** Adds a message and tries to send everything waiting. The oldest are dropped if the queue overflows. */
  async add(text) {
    this.waiting.push(text);
    if (this.waiting.length > OUTBOX_LIMIT) this.log(`Telegram outbox full: dropped ${this.waiting.splice(0, this.waiting.length - OUTBOX_LIMIT).length} old message(s).`);
    await this.flush();
  }

  /** Sends in order and stops at the first failure. The rest wait for the next attempt. */
  async flush() {
    if (this.isFlushing) return;
    this.isFlushing = true;
    try {
      while (this.waiting.length) {
        await this.deliver(this.waiting[0]);
        this.waiting.shift();
      }
    } catch (error) {
      this.log(`${error.message} ${this.waiting.length} message(s) waiting to retry.`);
    } finally {
      this.isFlushing = false;
    }
  }
}

/** Says something on the phone when Deriv has been failing for about 10 minutes, and again when it recovers. */
export class HealthNotice {
  constructor() {
    this.failedChecks = 0;
    this.hasWarned = false;
  }

  /** Takes the result of one check round. Returns a message to send, or null. */
  update(status, nameOf) {
    if (!status.failures.length) {
      const recovered = this.hasWarned;
      this.failedChecks = 0;
      this.hasWarned = false;
      return recovered ? 'Alerts are working again. Setups during the outage were not sent.' : null;
    }
    this.failedChecks++;
    if (this.hasWarned || this.failedChecks < CHECKS_BEFORE_WARNING) return null;
    this.hasWarned = true;
    return `No alerts right now: could not check ${status.failures.map((failure) => nameOf(failure.symbol)).join(', ')}. Still retrying.`;
  }
}

/** Writes one phone message for all the setups a market produced in one check. */
export function formatAlerts(alerts, { marketName, formatPrice, timeframeLabel }) {
  const heading = `${marketName} ${timeframeLabel}`;
  const lines = alerts.map((alert) => `${alert.direction === 'buy' ? '🟢' : '🔴'} ${alert.message}\n${formatPrice(alert.price)} · ${localTime.format(new Date(alert.time * 1000))}`);
  return `${heading}\n${lines.join('\n')}`;
}
