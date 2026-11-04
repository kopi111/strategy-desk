// One-time setup: connects your Telegram bot, saves it, sends a test message and starts the background service.
// Run in a normal terminal: node alerts/telegram-setup.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { CREDENTIALS_FILE, saveCredentials, TelegramBot } from './telegram.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_NAME = 'strategy-desk-telegram.service';
const WAIT_FOR_MESSAGE_SECONDS = 300;
const LONG_POLL_SECONDS = 20;

/** Asks for the token without showing it on screen. */
async function askForToken() {
  const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const writeToScreen = reader._writeToOutput;
  const question = reader.question('Paste the bot token from BotFather (it stays hidden), then press Enter: ');
  reader._writeToOutput = () => {};
  const token = (await question).trim();
  reader._writeToOutput = writeToScreen;
  reader.close();
  console.log('');
  if (!token) throw new Error('No token was entered.');
  return token;
}

/** Waits for your first message to the bot. That message is how the bot learns which chat to send alerts to. */
async function waitForFirstMessage(bot) {
  const deadline = Date.now() + WAIT_FOR_MESSAGE_SECONDS * 1000;
  while (Date.now() < deadline) {
    const updates = await bot.call('getUpdates', { timeout: LONG_POLL_SECONDS });
    const update = updates.find((item) => item.message && item.message.chat.type === 'private');
    if (update) return update.message;
  }
  throw new Error('No message arrived within 5 minutes. Run the setup again.');
}

/** Installs the background service from its template, using this machine's node and project paths. */
function installService() {
  const unitDirectory = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(unitDirectory, { recursive: true });
  const unit = readFileSync(join(HERE, `${SERVICE_NAME}.template`), 'utf8')
    .replaceAll('@NODE@', process.execPath)
    .replaceAll('@PROJECT@', dirname(HERE));
  writeFileSync(join(unitDirectory, SERVICE_NAME), unit);
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
  execFileSync('systemctl', ['--user', 'enable', SERVICE_NAME], { stdio: 'inherit' });
  execFileSync('systemctl', ['--user', 'restart', SERVICE_NAME], { stdio: 'inherit' });
}

/** Lets the service start at boot without logging in first. Failure here is reported, not fatal. */
function keepRunningWithoutLogin() {
  try {
    execFileSync('loginctl', ['enable-linger', process.env.USER], { stdio: 'pipe' });
  } catch {
    console.log(`Could not turn on start-at-boot. Alerts start when you log in. To fix it, run: sudo loginctl enable-linger ${process.env.USER}`);
  }
}

/** Walks through the setup. Each step is reported only after it has really succeeded. */
async function main() {
  const bot = new TelegramBot(await askForToken());
  const me = await bot.call('getMe');
  console.log(`Token works. Your bot is @${me.username}.`);
  console.log(`Now open Telegram, find @${me.username}, press Start or send it any message. Waiting...`);

  const { chat } = await waitForFirstMessage(bot);
  await bot.sendMessage(chat.id, 'Strategy Desk connected. Setup alerts will arrive here.');
  console.log(`Test message sent to ${chat.first_name || 'your chat'}. Check that it arrived on your phone.`);

  saveCredentials(bot.token, chat.id);
  console.log(`Saved to ${CREDENTIALS_FILE}.`);

  installService();
  keepRunningWithoutLogin();
  console.log('Background service started. You should now get a "Phone alerts started" message.');
}

main().catch((error) => {
  console.error(`Setup stopped: ${error.message}`);
  process.exit(1);
});
