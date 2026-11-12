// Run: node tests/mentor.test.mjs
// Checks the Mentor page's plan check and losing-run maths on plans where the right answer is known.
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const APA = loadCore();
const { review, rewardToRisk } = APA.tradePlanCheck;
const { table, accountLeft, gainToRecover, breakEvenWinRate } = APA.riskStreak;
const LIMITS = { minRewardToRisk: 3, maxRiskPercent: 2 };
const GOOD_BUY = { direction: 'buy', entry: 100, stop: 99, target: 104, riskPercent: 1, reason: 'Retest of the 1H RBS level' };

// This function runs one named test and prints the result.
function test(name, body) {
  body();
  console.log(`ok   ${name}`);
}

// This function returns the status the review gave one rule.
function statusOf(result, id) {
  return result.checks.find((check) => check.id === id).status;
}

test('a complete buy plan with 1:4 and 1% risk is ready', () => {
  const result = review(GOOD_BUY, LIMITS);
  assert.equal(result.ready, true);
  assert.equal(result.toFix.length, 0);
  assert.equal(rewardToRisk(GOOD_BUY), 4);
});

test('no stop-loss means the plan is never ready', () => {
  const result = review({ ...GOOD_BUY, stop: NaN }, LIMITS);
  assert.equal(result.ready, false);
  assert.equal(statusOf(result, 'stop'), 'fix');
  assert.equal(result.toFix[0].field, 'stop');
});

test('a buy stop above the entry and a sell stop below the entry are both caught', () => {
  assert.equal(statusOf(review({ ...GOOD_BUY, stop: 101 }, LIMITS), 'stop'), 'fix');
  const sell = { ...GOOD_BUY, direction: 'sell', stop: 99, target: 96 };
  assert.equal(statusOf(review(sell, LIMITS), 'stop'), 'fix');
  assert.equal(review({ ...sell, stop: 101 }, LIMITS).ready, true);
});

test('reward to risk under the minimum must be fixed', () => {
  const result = review({ ...GOOD_BUY, target: 102 }, LIMITS);
  assert.equal(statusOf(result, 'reward'), 'fix');
  assert.match(result.checks.find((check) => check.id === 'reward').text, /1:2\.0/);
});

test('a missing take-profit is a warning, not a block', () => {
  const result = review({ ...GOOD_BUY, target: NaN }, LIMITS);
  assert.equal(statusOf(result, 'target'), 'warn');
  assert.equal(statusOf(result, 'reward'), 'warn');
  assert.equal(result.ready, true);
});

test('risk above the cap, no risk, and no reason are all caught', () => {
  assert.equal(statusOf(review({ ...GOOD_BUY, riskPercent: 3 }, LIMITS), 'risk'), 'fix');
  assert.equal(statusOf(review({ ...GOOD_BUY, riskPercent: NaN }, LIMITS), 'risk'), 'fix');
  assert.equal(statusOf(review({ ...GOOD_BUY, reason: '  ' }, LIMITS), 'reason'), 'fix');
});

test('losing runs compound and the gain to recover is larger than the loss', () => {
  assert.ok(Math.abs(accountLeft(1, 10) - 0.904382) < 1e-6);
  assert.ok(Math.abs(gainToRecover(0.8) - 0.25) < 1e-12);
  assert.equal(gainToRecover(0), Infinity);
  const rows = table(2);
  assert.deepEqual(rows.map((row) => row.losses), [3, 5, 10, 15, 20]);
  assert.ok(rows.every((row) => row.gainNeeded > row.drawdown));
  assert.throws(() => table(0), RangeError);
});

test('break-even win rate at 1:3 is 25%', () => {
  assert.equal(breakEvenWinRate(3), 0.25);
  assert.equal(breakEvenWinRate(1), 0.5);
});
