(function (APA) {
  'use strict';

  /**
   * Turns closed backtest trades into money results. Each trade risks riskPercent of the balance at the time
   * it opened (compounding), so +3R on a $10,000 account at 1% is +$300.
   */
  function fromBacktestTrades(trades, startingBalance, riskPercent) {
    let balance = startingBalance;
    return trades.filter((trade) => trade.status === 'closed').map((trade) => {
      const pnl = balance * (riskPercent / 100) * trade.netR;
      balance += pnl;
      return {
        time: trade.exitTime, pnl, r: trade.netR, model: APA.zones.model(trade.model).name,
        session: trade.session, direction: trade.direction,
      };
    });
  }

  /** Win rate, profit factor, drawdown and equity curve for any list of { time, pnl, r? } results. */
  function summarize(results, startingBalance) {
    const ordered = results.slice().sort((first, second) => first.time - second.time);
    const wins = ordered.filter((result) => result.pnl > 0);
    const losses = ordered.filter((result) => result.pnl < 0);
    const grossWin = sum(wins.map((result) => result.pnl));
    const grossLoss = Math.abs(sum(losses.map((result) => result.pnl)));
    const withR = ordered.filter((result) => Number.isFinite(result.r));
    const { equity, maxDrawdown, maxDrawdownPercent } = equityCurve(ordered, startingBalance);

    return {
      count: ordered.length,
      wins: wins.length,
      losses: losses.length,
      winRate: ordered.length ? wins.length / ordered.length : 0,
      net: grossWin - grossLoss,
      netPercent: startingBalance ? ((grossWin - grossLoss) / startingBalance) * 100 : 0,
      averageWin: wins.length ? grossWin / wins.length : 0,
      averageLoss: losses.length ? -grossLoss / losses.length : 0,
      profitFactor: grossLoss ? grossWin / grossLoss : (grossWin ? Infinity : 0),
      averageR: withR.length ? sum(withR.map((result) => result.r)) / withR.length : null,
      totalR: withR.length ? sum(withR.map((result) => result.r)) : null,
      maxDrawdown,
      maxDrawdownPercent,
      equity,
    };
  }

  function equityCurve(ordered, startingBalance) {
    let balance = startingBalance;
    let peak = startingBalance;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    const equity = [];
    for (const result of ordered) {
      balance += result.pnl;
      peak = Math.max(peak, balance);
      maxDrawdown = Math.max(maxDrawdown, peak - balance);
      maxDrawdownPercent = Math.max(maxDrawdownPercent, peak ? ((peak - balance) / peak) * 100 : 0);
      equity.push({ time: result.time, value: balance });
    }
    return { equity, maxDrawdown, maxDrawdownPercent };
  }

  /** Splits results by a field (model, session, direction...) and summarises each group. */
  function groupBy(results, field, startingBalance) {
    const groups = new Map();
    for (const result of results) {
      const key = result[field] || 'Unlabelled';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(result);
    }
    return [...groups.entries()]
      .map(([name, members]) => ({ name, ...summarize(members, startingBalance) }))
      .sort((first, second) => second.net - first.net);
  }

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  APA.performance = { fromBacktestTrades, summarize, groupBy };
})((globalThis.APA = globalThis.APA || {}));
