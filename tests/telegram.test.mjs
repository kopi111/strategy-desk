// Run: node tests/telegram.test.mjs
// Tests the phone-alert code with a fake Telegram, so no real message is sent.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAT_ID_KEY, formatAlerts, HealthNotice, loadCredentials, Outbox, parseCredentials, saveCredentials, TelegramBot, TOKEN_KEY, withTelegramCredentials } from '../alerts/telegram.mjs';

let passed = 0;

// Runs one named test and prints the result.
async function test(name, body) {
  await body();
  passed++;
  console.log(`ok   ${name}`);
}

// A fake web request function that gives back the listed answers in order and records each call.
function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return { json: async () => answer };
  };
  return { calls, fetchImpl };
}

const SECRET = '123:SECRET-TOKEN';

await test('sending a message uses the right chat and text', async () => {
  const { calls, fetchImpl } = fakeFetch([{ ok: true, result: { message_id: 1 } }]);
  await new TelegramBot(SECRET, { fetchImpl }).sendMessage('42', 'hello');
  assert.equal(calls[0].body.chat_id, '42');
  assert.equal(calls[0].body.text, 'hello');
  assert.match(calls[0].url, /\/sendMessage$/);
});

await test('when Telegram says slow down, it waits as asked and sends again', async () => {
  const { calls, fetchImpl } = fakeFetch([{ ok: false, parameters: { retry_after: 7 } }, { ok: true, result: {} }]);
  const waits = [];
  await new TelegramBot(SECRET, { fetchImpl, wait: async (ms) => waits.push(ms) }).sendMessage('42', 'hello');
  assert.deepEqual(waits, [7000]);
  assert.equal(calls.length, 2);
});

await test('errors never reveal the token', async () => {
  const refused = new TelegramBot(SECRET, { fetchImpl: fakeFetch([{ ok: false, description: 'Unauthorized' }]).fetchImpl });
  await assert.rejects(refused.sendMessage('42', 'x'), (error) => !error.message.includes('SECRET') && error.message.includes('Unauthorized'));
  const offline = new TelegramBot(SECRET, { fetchImpl: fakeFetch([new Error(`fetch failed https://api.telegram.org/bot${SECRET}`)]).fetchImpl });
  await assert.rejects(offline.sendMessage('42', 'x'), (error) => !error.message.includes('SECRET'));
});

await test('a failed send keeps the alert and delivers it, in order, on the next try', async () => {
  const delivered = [];
  let isOnline = false;
  const outbox = new Outbox(async (text) => { if (!isOnline) throw new Error('offline'); delivered.push(text); }, () => {});
  await outbox.add('first');
  await outbox.add('second');
  assert.deepEqual(delivered, []);
  isOnline = true;
  await outbox.flush();
  assert.deepEqual(delivered, ['first', 'second']);
  assert.equal(outbox.waiting.length, 0);
});

await test('the phone is warned once after about 10 minutes of failures, then told when it recovers', () => {
  const health = new HealthNotice();
  const failing = { failures: [{ symbol: 'R_75', message: 'closed' }] };
  const nameOf = () => 'Volatility 75';
  const messages = [];
  for (let check = 0; check < 40; check++) { const notice = health.update(failing, nameOf); if (notice) messages.push(notice); }
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Volatility 75/);
  assert.match(health.update({ failures: [] }, nameOf), /working again/);
  assert.equal(health.update({ failures: [] }, nameOf), null);
});

await test('one failed check that recovers never disturbs the phone', () => {
  const health = new HealthNotice();
  assert.equal(health.update({ failures: [{ symbol: 'R_75' }] }, () => 'x'), null);
  assert.equal(health.update({ failures: [] }, () => 'x'), null);
});

await test('an alert message names the market, setup, price and Jamaica time', () => {
  const text = formatAlerts([{ direction: 'buy', message: 'Price reached a bullish order block', price: 34500.5, time: Date.UTC(2026, 10, 3, 16, 0) / 1000 }],
    { marketName: 'Volatility 75', timeframeLabel: '15m', formatPrice: (price) => price.toFixed(2) });
  assert.match(text, /^Volatility 75 15m\n/);
  assert.match(text, /🟢 Price reached a bullish order block/);
  assert.match(text, /34500\.50/);
  assert.match(text, /Nov 3, 11:00 AM/);
});

await test('saving credentials leaves other projects alone, replaces old values, and keeps the file private', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'desk-telegram-')), 'all.env');
  writeFileSync(file, '# ===== Other =====\nOTHER_KEY=keep-me\n');
  saveCredentials('old-token', '1', file);
  saveCredentials('new-token', '2', file);
  const text = readFileSync(file, 'utf8');
  assert.equal(parseCredentials(text).OTHER_KEY, 'keep-me');
  assert.deepEqual(loadCredentials(file), { token: 'new-token', chatId: '2' });
  assert.equal(text.split(`${TOKEN_KEY}=`).length, 2, 'the token must appear once');
  assert.equal(text.split('Strategy Desk phone alerts').length, 2, 'the heading must appear once');
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

await test('missing credentials say which command to run', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'desk-telegram-')), 'all.env');
  writeFileSync(file, withTelegramCredentials('', '', ''));
  assert.throws(() => loadCredentials(file), /telegram-setup\.mjs/);
  assert.ok(CHAT_ID_KEY);
});

console.log(`\n${passed} tests passed.`);
