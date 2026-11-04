(function (APA) {
  'use strict';

  // Results of research/potential-trade/backtest.mjs on this exact rule, after spread. Run that script again if the rule changes.
  const RESULTS = {
    frxXAUUSD: { trades: 2142, winRate: 29.2, breakEven: 27.6, netR: -0.026 },
    R_10: { trades: 1017, winRate: 29.6, breakEven: 27.6, netR: -0.007 },
    R_15: { trades: 827, winRate: 25.6, breakEven: 26.5, netR: -0.135 },
    R_25: { trades: 1015, winRate: 29.2, breakEven: 27.2, netR: -0.161 },
    R_30: { trades: 787, winRate: 31.0, breakEven: 27.9, netR: -0.069 },
    R_50: { trades: 1067, winRate: 29.1, breakEven: 28.0, netR: -0.136 },
    R_75: { trades: 950, winRate: 27.4, breakEven: 26.7, netR: -0.115 },
    R_90: { trades: 833, winRate: 25.5, breakEven: 27.4, netR: -0.191 },
    R_100: { trades: 1034, winRate: 26.4, breakEven: 28.0, netR: -0.144 },
    '1HZ10V': { trades: 960, winRate: 28.5, breakEven: 28.0, netR: -0.071 },
    '1HZ15V': { trades: 985, winRate: 27.8, breakEven: 27.5, netR: -0.077 },
    '1HZ25V': { trades: 1012, winRate: 27.5, breakEven: 28.1, netR: -0.202 },
    '1HZ30V': { trades: 979, winRate: 28.1, breakEven: 27.2, netR: -0.150 },
    '1HZ50V': { trades: 975, winRate: 26.4, breakEven: 26.9, netR: -0.184 },
    '1HZ75V': { trades: 1028, winRate: 27.8, breakEven: 27.5, netR: -0.070 },
    '1HZ90V': { trades: 1014, winRate: 28.4, breakEven: 27.3, netR: 0.020 },
    '1HZ100V': { trades: 1005, winRate: 25.4, breakEven: 27.4, netR: -0.114 },
    '1HZ150V': { trades: 1082, winRate: 25.9, breakEven: 27.3, netR: -0.072 },
    '1HZ250V': { trades: 985, winRate: 27.3, breakEven: 27.3, netR: -0.036 },
  };

  /** One line for the pages: what this rule did on this market when tested, in words a trader can read at a glance. */
  function describe(symbol) {
    const result = RESULTS[symbol];
    if (!result) return { text: 'Backtest: not tested on this market.', tone: 'proof-untested' };
    const perTrade = `${result.netR >= 0 ? '+' : ''}${result.netR.toFixed(3)}R a trade`;
    const summary = `${result.trades.toLocaleString('en-US')} trades, won ${result.winRate.toFixed(1)}%, ${perTrade} after spread.`;
    // A small gain is not proof: V90 1s made about the same on shuffled candles, and its spread is an assumption.
    if (result.netR >= 0) return { text: `Backtest: no proven edge. ${summary}`, tone: 'proof-untested' };
    return { text: `Backtest: lost money. ${summary}`, tone: 'proof-lost' };
  }

  APA.potentialTradeBacktest = { describe };
})((globalThis.APA = globalThis.APA || {}));
