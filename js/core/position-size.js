(function (APA) {
  'use strict';

  /** Thrown when a calculator input is wrong; `field` names the box so the form can point at it. */
  class InputError extends Error {
    constructor(field, message) {
      super(message);
      this.field = field;
    }
  }

  /**
   * Position size from account risk. Loss at the stop = lots × contract size × stop distance × USD per price
   * unit. Lots round DOWN to the broker's step so the real risk never exceeds the chosen percentage.
   */
  function calculate(input) {
    const { instrument, direction, balance, riskPercent, entry, stop, target } = input;
    requirePositive('balance', balance, 'Account balance must be above 0.');
    requirePositive('riskPercent', riskPercent, 'Risk % must be above 0.');
    if (riskPercent > 100) throw new InputError('riskPercent', 'Risk % cannot be more than 100.');
    requirePositive('entry', entry, 'Entry price must be above 0.');
    requirePositive('stop', stop, 'Stop-loss price must be above 0.');
    checkSides(direction, entry, stop, target);

    const stopDistance = Math.abs(entry - stop);
    const usdPerUnit = APA.instruments.usdPerPriceUnit(instrument, entry);
    const lossPerLot = stopDistance * instrument.contractSize * usdPerUnit;
    const cashRisk = balance * (riskPercent / 100);
    const rawLots = cashRisk / lossPerLot;
    const lots = roundDownToStep(rawLots, instrument.lotStep);
    if (lots < instrument.minLot) {
      throw new InputError('stop', `Stop is too wide for this risk: needs ${rawLots.toFixed(4)} lots but the minimum is ${instrument.minLot}. Raise risk % or tighten the stop.`);
    }
    const potentialLoss = lots * lossPerLot;
    const hasTarget = Number.isFinite(target) && target > 0;
    const targetDistance = hasTarget ? Math.abs(target - entry) : null;
    const potentialProfit = hasTarget ? lots * targetDistance * instrument.contractSize * APA.instruments.usdPerPriceUnit(instrument, target) : null;

    return {
      cashRisk,
      lots,
      stopDistance,
      stopPips: stopDistance / instrument.pipSize,
      targetPips: hasTarget ? targetDistance / instrument.pipSize : null,
      potentialLoss,
      potentialProfit,
      rewardToRisk: hasTarget ? targetDistance / stopDistance : null,
      actualRiskPercent: (potentialLoss / balance) * 100,
    };
  }

  function requirePositive(field, value, message) {
    if (!Number.isFinite(value) || value <= 0) throw new InputError(field, message);
  }

  function checkSides(direction, entry, stop, target) {
    const buying = direction === 'buy';
    if (buying && stop >= entry) throw new InputError('stop', 'For a buy, the stop loss must be below the entry.');
    if (!buying && stop <= entry) throw new InputError('stop', 'For a sell, the stop loss must be above the entry.');
    if (!Number.isFinite(target) || target <= 0) return;
    if (buying && target <= entry) throw new InputError('target', 'For a buy, the take profit must be above the entry.');
    if (!buying && target >= entry) throw new InputError('target', 'For a sell, the take profit must be below the entry.');
  }

  function roundDownToStep(value, step) {
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
    return Number((Math.floor(value / step + 1e-9) * step).toFixed(decimals));
  }

  APA.positionSize = { calculate, InputError };
})((globalThis.APA = globalThis.APA || {}));
