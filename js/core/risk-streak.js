(function (APA) {
  'use strict';

  const STREAK_LENGTHS = [3, 5, 10, 15, 20];

  // This function works out how much of the account is left after a run of losses in a row.
  // Each loss takes the risk % of what is left, so the losses shrink as the account shrinks.
  function accountLeft(riskPercent, losses) {
    return (1 - riskPercent / 100) ** losses;
  }

  // This function works out the gain needed to get back to the starting balance.
  // It takes the share of the account that is left and returns the gain as a fraction.
  function gainToRecover(shareLeft) {
    if (shareLeft <= 0) return Infinity;
    return 1 / shareLeft - 1;
  }

  // This function builds the losing-run table for one risk %.
  function table(riskPercent) {
    if (!Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent >= 100) {
      throw new RangeError('Risk % must be above 0 and below 100.');
    }
    return STREAK_LENGTHS.map((losses) => {
      const shareLeft = accountLeft(riskPercent, losses);
      return { losses, shareLeft, drawdown: 1 - shareLeft, gainNeeded: gainToRecover(shareLeft) };
    });
  }

  // This function returns the win rate needed to break even at a reward-to-risk ratio, before costs.
  function breakEvenWinRate(rewardToRisk) {
    return 1 / (1 + rewardToRisk);
  }

  APA.riskStreak = { table, accountLeft, gainToRecover, breakEvenWinRate, STREAK_LENGTHS };
})((globalThis.APA = globalThis.APA || {}));
