(function (APA) {
  'use strict';

  // Results of research/potential-trade/backtest.mjs on this exact rule, after spread. Run that script again if the rule changes.
  const RESULTS = {
    frxXAUUSD: { trades: 2142, winRate: 29.2, breakEven: 27.6, netR: -0.026 },
    R_10: { trades: 1017, winRate: 29.6, breakEven: 27.6, netR: -0.007 },
    R_25: { trades: 1015, winRate: 29.2, breakEven: 27.2, netR: -0.161 },
    R_50: { trades: 1067, winRate: 29.1, breakEven: 28.0, netR: -0.136 },
    R_75: { trades: 950, winRate: 27.4, breakEven: 26.7, netR: -0.115 },
    R_100: { trades: 1034, winRate: 26.4, breakEven: 28.0, netR: -0.144 },
    '1HZ10V': { trades: 960, winRate: 28.5, breakEven: 28.0, netR: -0.071 },
    '1HZ25V': { trades: 1012, winRate: 27.5, breakEven: 28.1, netR: -0.202 },
    '1HZ50V': { trades: 975, winRate: 26.4, breakEven: 26.9, netR: -0.184 },
    '1HZ75V': { trades: 1028, winRate: 27.8, breakEven: 27.5, netR: -0.070 },
    '1HZ100V': { trades: 1005, winRate: 25.4, breakEven: 27.4, netR: -0.114 },
  };

  /** One line for the pages: what this rule did on this market when tested, in words a trader can read at a glance. */
  function describe(symbol) {
    const result = RESULTS[symbol];
    if (!result) return { text: 'Backtest: not tested on this market.', tone: 'proof-untested' };
    const perTrade = `${result.netR >= 0 ? '+' : ''}${result.netR.toFixed(3)}R a trade`;
    return {
      text: `Backtest: lost money. ${result.trades.toLocaleString('en-US')} trades, won ${result.winRate.toFixed(1)}%, ${perTrade} after spread.`,
      tone: 'proof-lost',
    };
  }

  APA.potentialTradeBacktest = { describe };
})((globalThis.APA = globalThis.APA || {}));
