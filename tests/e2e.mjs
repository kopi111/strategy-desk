// Headless walk-through: opens every view, exercises the main controls, fails on any console error.
// Run: node tests/e2e.mjs [url]   (serve the folder first, e.g. python3 -m http.server 8765)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/kopi/projects/IdVerifyReset/tests/e2e/node_modules/playwright');

const URL = process.argv[2] || 'http://127.0.0.1:8765/';
const SHOTS = process.env.SHOTS || '';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
// Deriv's endpoint failing is reported by the browser itself; the app handles it by falling back to demo data.
const EXPECTED = /WebSocket connection to 'wss:\/\/ws\.derivws\.com/;
page.on('console', (message) => { if (message.type() === 'error' && !EXPECTED.test(message.text())) errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const step = async (name, action) => {
  try { await action(); console.log(`ok   ${name}`); }
  catch (error) { console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`); errors.push(`${name}: ${error.message}`); }
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

await page.goto(URL);
await step('signal renders', async () => { await page.waitForSelector('.signal-ring', { timeout: 30000 }); });
await step('source badge settles', async () => { await page.waitForFunction(() => !document.querySelector('#sourceBadge').textContent.includes('CONNECTING'), null, { timeout: 30000 }); });
console.log('     source:', await page.textContent('#sourceBadge'), '| signal:', await page.textContent('.signal-ring strong'));
await step('ML model panel reads the newest hourly candle', async () => {
  await page.waitForSelector('.ml-reading .kpi-value', { timeout: 30000 });
  await page.waitForSelector('.ml-tests .plan-cell', { timeout: 5000 });
});
console.log('     ml:', (await page.textContent('[data-slot="ml-reading"] .ml-reading')).replace(/\s+/g, ' ').trim().slice(0, 160));
await shot('01-dashboard');

await step('scanner runs', async () => {
  await page.click('[data-action="scan"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="scanner"] tbody tr').length >= 19, null, { timeout: 120000 });
});
await shot('02-dashboard-scanned');

await step('chart opens filling the window, keeps a market picker, and Esc returns to the page', async () => {
  await page.click('.nav-item[data-view="chart"]');
  await page.waitForSelector('[data-slot="chart"] canvas', { timeout: 15000 });
  const size = await page.locator('.deriv-chart').boundingBox();
  if (size.x !== 0 || size.y !== 0 || size.width !== 1480 || size.height !== 1000) throw new Error(`not full window: ${JSON.stringify(size)}`);
  // A size check alone is not enough: nothing may sit on top of the chart, such as the sidebar.
  const isCovered = await page.evaluate(() => [[20, 300], [120, 500], [700, 500], [1460, 980], [60, 20]].some(([x, y]) => !document.elementFromPoint(x, y).closest('.deriv-chart')));
  if (isCovered) throw new Error('something is covering the full-screen chart');
  const chartBox = await page.locator('[data-slot="chart"]').boundingBox();
  if (chartBox.height < 800) throw new Error(`the chart area is only ${chartBox.height}px tall`);
  if (!(await page.isVisible('[data-slot="full-market"]'))) throw new Error('no market picker in full view');
  await page.selectOption('[data-slot="full-market"]', 'R_100');
  await page.waitForFunction(() => document.querySelector('.chart-legend b')?.textContent.includes('Volatility 100 Index') && !document.querySelector('.chart-loading'), null, { timeout: 60000 });
  await page.selectOption('[data-slot="full-market"]', 'R_75');
  await page.waitForFunction(() => document.querySelector('.chart-legend b')?.textContent.includes('Volatility 75 Index') && !document.querySelector('.chart-loading'), null, { timeout: 60000 });
  await shot('03a-full-view');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.view[data-view="chart"]').classList.contains('is-full-view'));
  if (!(await page.isVisible('#sidebar'))) throw new Error('the sidebar did not come back');
});

await step('chart view', async () => {
  await page.click('[data-slot="timeframes"] button[data-value="5m"]');
  await page.waitForTimeout(800);
  await page.click('[data-slot="timeframes"] button[data-value="1h"]');
  await page.waitForTimeout(800);
});
await shot('03-chart');

await step('chart shows the potential trade card, and it can be hidden', async () => {
  await page.waitForSelector('[data-slot="trade-card"]:not([hidden]) strong', { timeout: 30000 });
  await page.click('[data-action="toggle-trade-lines"]');
  await page.waitForSelector('[data-slot="trade-card"]', { state: 'hidden', timeout: 30000 });
  await page.click('[data-action="toggle-trade-lines"]');
  await page.waitForSelector('[data-slot="trade-card"]:not([hidden]) strong', { timeout: 30000 });
});

await step('chart is marked up on real candles, and a toggle changes it', async () => {
  await page.waitForFunction(() => document.querySelectorAll('[data-slot="recent-events"] li').length > 0, null, { timeout: 30000 });
  const before = await page.textContent('[data-slot="recent-events"]');
  await page.uncheck('input[data-markup="fvg"]');
  await page.uncheck('input[data-markup="ob"]');
  await page.uncheck('input[data-markup="bos"]');
  await page.uncheck('input[data-markup="mss"]');
  await page.uncheck('input[data-markup="sweep"]');
  await page.waitForSelector('[data-slot="structure"] .empty');
  for (const concept of ['fvg', 'ob', 'bos', 'mss', 'sweep']) await page.check(`input[data-markup="${concept}"]`);
  if (!before.trim()) throw new Error('the event list was empty');
});
await shot('03b-chart-markup');

await step('Deriv-style tools: trend line saves, range, scale and delete all work', async () => {
  const box = await page.locator('[data-slot="chart"]').boundingBox();
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  const saved = () => page.evaluate(() => APA.views.chart.tools.drawings.length);
  await page.click('[data-tool-action="clear"]');
  await page.click('[data-tool-action="trend"]');
  await page.mouse.click(...at(0.4, 0.4));
  await page.mouse.click(...at(0.6, 0.6));
  if ((await saved()) !== 1) throw new Error('the trend line was not saved');
  await page.click('[data-tool-action="hline"]');
  await page.mouse.click(...at(0.5, 0.5));
  if ((await saved()) !== 2) throw new Error('the horizontal line was not saved');
  await page.click('[data-tool-action="cross"]');
  await page.click('[data-scale="log"]');
  if ((await page.evaluate(() => APA.views.chart.chart.chart.priceScale('right').options().mode)) !== 1) throw new Error('log scale did not apply');
  await page.click('[data-scale="log"]');
  await page.click('[data-range="5d"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="timeframes"] button[data-value="15m"]').getAttribute('aria-checked') === 'true' && !document.querySelector('.chart-loading'), null, { timeout: 60000 });
  await page.click('[data-tool-action="clear"]');
  if ((await saved()) !== 0) throw new Error('delete did not clear the drawings');
});

await step('a dragged price scale cannot blank the next market', async () => {
  const box = await page.locator('[data-slot="chart"]').boundingBox();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2 + 80, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-scale="auto"]').getAttribute('aria-pressed') === 'false');
  await page.selectOption('#symbolSelect', '1HZ75V');
  await page.waitForFunction(() => document.querySelector('.chart-legend b')?.textContent.includes('75 (1s)') && !document.querySelector('.chart-loading'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const isOnScreen = await page.evaluate(() => { const chart = APA.views.chart.chart; return chart.series.priceToCoordinate(chart.series.data().at(-1).close) > 0 && chart.series.priceToCoordinate(chart.series.data().at(-1).close) < 800; });
  if (!isOnScreen) throw new Error('the candles were off-screen after switching market');
  if ((await page.getAttribute('[data-scale="auto"]', 'aria-pressed')) !== 'true') throw new Error('auto did not turn back on');
  await page.selectOption('#symbolSelect', 'R_75');
  await page.waitForFunction(() => document.querySelector('.chart-legend b')?.textContent.includes('Volatility 75 Index') && !document.querySelector('.chart-loading'), null, { timeout: 60000 });
});

await step('the sidebar and the details hide, stay hidden after a reload, and come back', async () => {
  const chartWidth = () => page.locator('[data-slot="chart"]').evaluate((box) => box.clientWidth);
  const before = await chartWidth();
  await page.click('#menuButton');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#sidebar')).display === 'none');
  if ((await chartWidth()) <= before) throw new Error('the chart did not widen when the sidebar was hidden');
  await page.click('[data-action="toggle-details"]');
  if (await page.isVisible('[data-slot="structure"]')) throw new Error('the details did not hide');
  await page.reload();
  await page.waitForSelector('[data-slot="chart"] canvas', { timeout: 60000 });
  if (await page.isVisible('#sidebar')) throw new Error('the sidebar came back after a reload');
  if (await page.isVisible('[data-slot="structure"]')) throw new Error('the details came back after a reload');
  await shot('03d-chart-only');
  await page.click('#menuButton');
  await page.click('[data-action="toggle-details"]');
  if (!(await page.isVisible('#sidebar')) || !(await page.isVisible('[data-slot="structure"]'))) throw new Error('they did not come back');
  await page.waitForFunction(() => !document.querySelector('.chart-loading'), null, { timeout: 60000 });
});

await step('alerts page starts watching and tests delivery', async () => {
  await page.click('.nav-item[data-view="alerts"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="watch-state"]').textContent.trim() === 'Watching' && document.querySelector('[data-slot="alert-status"] p').textContent.includes('last checked'), null, { timeout: 90000 });
  await page.click('[data-action="test-alert"]');
  await page.waitForSelector('.toast');
  await shot('03c-alerts');
  await page.click('.nav-item[data-view="chart"]');
});

await step('switch market to gold', async () => {
  await page.selectOption('#symbolSelect', 'frxXAUUSD');
  await page.waitForFunction(() => document.querySelector('.chart-legend b')?.textContent === 'Gold / US Dollar', null, { timeout: 30000 });
});

await step('trades page lists a plan for every market and opens the chart', async () => {
  await page.click('.nav-item[data-view="trades"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="scan-progress"]')?.textContent.startsWith('Last checked'), null, { timeout: 120000 });
  const rows = await page.$$eval('[data-slot="plan-table"] tbody tr', (list) => list.length);
  const markets = await page.evaluate(() => APA.app.instruments.length);
  if (rows !== markets) throw new Error(`expected ${markets} rows, saw ${rows}`);
  if (!(await page.textContent('[data-slot="gold-rule"]')).includes('Backtest')) throw new Error('the gold rule shows no backtest result');
  await page.click('[data-slot="plan-table"] .trade-open');
  await page.waitForSelector('[data-slot="trade-card"]:not([hidden])', { timeout: 30000 });
});

await step('calculator validates and sizes', async () => {
  await page.click('.nav-item[data-view="calculator"]');
  await page.fill('[name="entry"]', '2400');
  await page.fill('[name="stop"]', '2410');
  await page.waitForSelector('.error-text');
  const message = await page.textContent('.error-text');
  if (!message.includes('below the entry')) throw new Error(`unexpected error text: ${message}`);
  await page.fill('[name="stop"]', '2390');
  await page.fill('[name="target"]', '2440');
  await page.waitForFunction(() => document.querySelector('.view[data-view="calculator"] [data-slot="results"]').textContent.includes('lots'));
  const results = await page.textContent('.view[data-view="calculator"] [data-slot="results"]');
  if (!results.includes('1:4.0')) throw new Error(`expected 1:4.0 in results: ${results.slice(0, 200)}`);
});
await shot('04-calculator');

await step('checklist gates validity', async () => {
  await page.click('.nav-item[data-view="checklist"]');
  if ((await page.textContent('[data-slot="status"] .tag')).trim() !== 'NOT VALID') throw new Error('should start NOT VALID');
  for (const box of await page.$$('input[data-check]')) await box.check();
  if ((await page.textContent('[data-slot="status"] .tag')).trim() !== 'VALID') throw new Error('should be VALID with all ticked');
  await page.click('[data-action="reset"]');
  if ((await page.textContent('[data-slot="status"] .tag')).trim() !== 'NOT VALID') throw new Error('reset failed');
});

await step('journal saves, filters, persists', async () => {
  await page.click('.nav-item[data-view="journal"]');
  await page.click('.view[data-view="journal"] [data-slot="form-panel"] summary');
  await page.selectOption('.view[data-view="journal"] [data-slot="form"] [name="symbol"]', 'frxXAUUSD');
  await page.fill('.view[data-view="journal"] [data-slot="form"] [name="entry"]', '2400');
  await page.fill('.view[data-view="journal"] [data-slot="form"] [name="stop"]', '2390');
  await page.fill('.view[data-view="journal"] [data-slot="form"] [name="lots"]', '0.5');
  await page.fill('.view[data-view="journal"] [data-slot="form"] [name="exit"]', '2430');
  await page.click('.view[data-view="journal"] [data-slot="form"] button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('.view[data-view="journal"] [data-slot="table"]').textContent.includes('+$1,500.00'));
  await page.reload();
  await page.waitForSelector('.signal-ring', { timeout: 30000, state: 'attached' });
  await page.click('.nav-item[data-view="journal"]');
  await page.waitForFunction(() => document.querySelector('.view[data-view="journal"] [data-slot="table"]').textContent.includes('+$1,500.00'));
  await page.selectOption('.view[data-view="journal"] [data-slot="filters"] [name="outcome"]', 'loss');
  await page.waitForFunction(() => document.querySelector('.view[data-view="journal"] [data-slot="table"]').textContent.includes('No trades match'));
  await page.selectOption('.view[data-view="journal"] [data-slot="filters"] [name="outcome"]', '');
});
await shot('05-journal');

await step('backtest runs', async () => {
  await page.click('.nav-item[data-view="backtest"]');
  await page.click('.view[data-view="backtest"] [data-slot="run"]');
  await page.waitForFunction(() => document.querySelector('.view[data-view="backtest"] [data-slot="results"]').textContent.includes('Every trade'), null, { timeout: 60000 });
});
await shot('06-backtest');

await step('analytics shows both sources', async () => {
  await page.click('.nav-item[data-view="analytics"]');
  await page.waitForSelector('[data-slot="stats"] .stat');
  await page.click('[data-slot="source"] button[data-value="backtest"]');
  await page.waitForFunction(() => document.querySelector('[data-slot="label"]').textContent.includes('Backtest'));
});
await shot('07-analytics');

await step('rules page', async () => {
  await page.click('.nav-item[data-view="rules"]');
  const cards = await page.$$('.model-card');
  if (cards.length !== 8) throw new Error(`expected 8 model cards, got ${cards.length}`);
});
await shot('08-rules');

await step('settings validation names the field', async () => {
  await page.click('.nav-item[data-view="settings"]');
  await page.fill('[name="risk.riskPercent"]', '5');
  await page.click('.view[data-view="settings"] button[type="submit"]');
  await page.waitForSelector('.view[data-view="settings"] .error-text');
  const message = await page.textContent('.view[data-view="settings"] .error-text');
  if (!message.includes('cap')) throw new Error(`unexpected: ${message}`);
  await page.fill('[name="risk.riskPercent"]', '1');
  await page.click('.view[data-view="settings"] button[type="submit"]');
  await page.waitForTimeout(1500);
});
await shot('09-settings');

for (const width of [400, 820]) {
  await step(`no sideways scroll at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['dashboard', 'chart', 'alerts', 'calculator', 'journal', 'backtest', 'settings', 'rules']) {
      await page.evaluate((name) => { location.hash = name; }, view);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error(`${view} overflows by ${overflow}px`);
    }
  });
}
await page.evaluate(() => { location.hash = 'dashboard'; });
await page.waitForTimeout(500);
await shot('10-mobile-dashboard');

await browser.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nAll steps passed, no console errors.');
process.exit(errors.length ? 1 : 0);
