(function (APA) {
  'use strict';

  const MINIMUM_REASON_LENGTH = 10;

  // This function checks a written trade plan against the risk rules.
  // It returns one line per rule and says the plan is ready only when no line needs fixing.
  function review(plan, limits) {
    const checks = [
      checkEntry(plan),
      checkStop(plan),
      checkTarget(plan),
      checkRewardToRisk(plan, limits.minRewardToRisk),
      checkRisk(plan.riskPercent, limits.maxRiskPercent),
      checkReason(plan.reason),
    ];
    const toFix = checks.filter((check) => check.status === 'fix');
    return { ready: toFix.length === 0, checks, toFix };
  }

  // This function makes one result line.
  // The field name lets the page jump to the box that needs fixing.
  function line(id, field, status, text) {
    return { id, field, status, text };
  }

  // This function says whether a value is a price above zero.
  function isPrice(value) {
    return Number.isFinite(value) && value > 0;
  }

  // This function checks that the plan has an entry price.
  function checkEntry(plan) {
    if (!isPrice(plan.entry)) return line('entry', 'entry', 'fix', 'Add the entry price.');
    return line('entry', 'entry', 'pass', 'Entry price is set.');
  }

  // This function checks that there is a stop-loss and that it sits on the losing side of the entry.
  function checkStop(plan) {
    if (!isPrice(plan.stop)) return line('stop', 'stop', 'fix', 'Add a stop-loss. No plan passes without one.');
    if (!isPrice(plan.entry)) return line('stop', 'stop', 'pass', 'Stop-loss is set.');
    if (plan.direction === 'buy' && plan.stop >= plan.entry) return line('stop', 'stop', 'fix', 'For a buy, the stop-loss must be below the entry.');
    if (plan.direction === 'sell' && plan.stop <= plan.entry) return line('stop', 'stop', 'fix', 'For a sell, the stop-loss must be above the entry.');
    return line('stop', 'stop', 'pass', 'Stop-loss is on the right side of the entry.');
  }

  // This function checks the take-profit.
  // A missing one is a warning, a wrong-side one must be fixed.
  function checkTarget(plan) {
    if (!isPrice(plan.target)) return line('target', 'target', 'warn', 'No take-profit. Decide where you will get out before you get in.');
    if (!isPrice(plan.entry)) return line('target', 'target', 'pass', 'Take-profit is set.');
    if (plan.direction === 'buy' && plan.target <= plan.entry) return line('target', 'target', 'fix', 'For a buy, the take-profit must be above the entry.');
    if (plan.direction === 'sell' && plan.target >= plan.entry) return line('target', 'target', 'fix', 'For a sell, the take-profit must be below the entry.');
    return line('target', 'target', 'pass', 'Take-profit is on the right side of the entry.');
  }

  // This function works out reward to risk and compares it with the minimum in Settings.
  function checkRewardToRisk(plan, minimum) {
    const ratio = rewardToRisk(plan);
    if (ratio === null) return line('reward', 'target', 'warn', 'Reward to risk cannot be worked out until entry, stop and take-profit are all set and on the right sides.');
    const shown = `1:${ratio.toFixed(1)}`;
    if (ratio < minimum) return line('reward', 'target', 'fix', `Reward to risk is ${shown}, below your 1:${minimum} minimum. Move the take-profit or skip the trade.`);
    return line('reward', 'target', 'pass', `Reward to risk is ${shown}, meets your 1:${minimum} minimum.`);
  }

  // This function returns the reward-to-risk ratio, or null when the prices do not make a valid trade.
  function rewardToRisk(plan) {
    const sides = [checkStop(plan), checkTarget(plan)];
    if (!isPrice(plan.entry) || sides.some((check) => check.status !== 'pass')) return null;
    return Math.abs(plan.target - plan.entry) / Math.abs(plan.entry - plan.stop);
  }

  // This function checks that the risk per trade is set and not above the cap in Settings.
  function checkRisk(riskPercent, maxRiskPercent) {
    if (!Number.isFinite(riskPercent) || riskPercent <= 0) return line('risk', 'riskPercent', 'fix', 'Set how much of the account you will risk, in %.');
    if (riskPercent > maxRiskPercent) return line('risk', 'riskPercent', 'fix', `Risk of ${riskPercent}% is above your ${maxRiskPercent}% cap.`);
    return line('risk', 'riskPercent', 'pass', `Risk of ${riskPercent}% is within your ${maxRiskPercent}% cap.`);
  }

  // This function checks that the trader wrote down why they are taking the trade.
  function checkReason(reason) {
    const text = String(reason ?? '').trim();
    if (text.length < MINIMUM_REASON_LENGTH) return line('reason', 'reason', 'fix', 'Write why you are taking it: the setup and the level.');
    return line('reason', 'reason', 'pass', 'The reason is written down.');
  }

  APA.tradePlanCheck = { review, rewardToRisk };
})((globalThis.APA = globalThis.APA || {}));
