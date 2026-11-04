(function (APA) {
  'use strict';

  // Contract sizes and spreads are typical Deriv MT5 / retail values. They differ between brokers and account
  // types, so every field is editable in Settings → Instruments. demoPrice only seeds the demo random walk.
  // pnlConversion: 'usd-quoted' means one price unit per contract is worth 1 USD;
  // 'usd-base' (USDJPY, USDCAD, USDCHF) means profit lands in the quote currency and is divided by price.
  const DEFAULT_INSTRUMENTS = [
    // Spreads for V15, V30, V90 and the 1s markets below V75 are not published figures. They use the nearest listed
    // market's spread as a share of price, so check them on your own account in Settings → Instruments.
    synthetic('R_10', 'Volatility 10 Index', 3, 6000, 0.6),
    synthetic('R_15', 'Volatility 15 Index', 3, 103000, 12.7),
    synthetic('R_25', 'Volatility 25 Index', 3, 2500, 1.2),
    synthetic('R_30', 'Volatility 30 Index', 3, 94800, 38.9),
    synthetic('R_50', 'Volatility 50 Index', 4, 200, 0.05),
    synthetic('R_75', 'Volatility 75 Index', 4, 40000, 25),
    synthetic('R_90', 'Volatility 90 Index', 3, 141000, 98.9),
    synthetic('R_100', 'Volatility 100 Index', 2, 1200, 0.4),
    synthetic('1HZ10V', 'Volatility 10 (1s) Index', 2, 9500, 1.2),
    synthetic('1HZ15V', 'Volatility 15 (1s) Index', 3, 13700, 1.7),
    synthetic('1HZ25V', 'Volatility 25 (1s) Index', 2, 911000, 374),
    synthetic('1HZ30V', 'Volatility 30 (1s) Index', 3, 6170, 2.5),
    synthetic('1HZ50V', 'Volatility 50 (1s) Index', 2, 202000, 102),
    synthetic('1HZ75V', 'Volatility 75 (1s) Index', 2, 3000, 2),
    synthetic('1HZ90V', 'Volatility 90 (1s) Index', 3, 30700, 9.3),
    synthetic('1HZ100V', 'Volatility 100 (1s) Index', 2, 900, 0.4),
    synthetic('1HZ150V', 'Volatility 150 (1s) Index', 2, 54, 0.02),
    synthetic('1HZ250V', 'Volatility 250 (1s) Index', 5, 0.24, 0.00007),
    synthetic('BOOM1000', 'Boom 1000 Index', 4, 15000, 1.5),
    synthetic('CRASH1000', 'Crash 1000 Index', 4, 7000, 1.5),
    synthetic('stpRNG', 'Step Index', 1, 8000, 0.1, 10),
    synthetic('stpRNG2', 'Step Index 200', 1, 10000, 0.2, 10),
    {
      symbol: 'frxXAUUSD', name: 'Gold / US Dollar', shortName: 'XAUUSD', group: 'Gold',
      decimals: 2, pipSize: 0.1, contractSize: 100, minLot: 0.01, lotStep: 0.01,
      spread: 0.3, pnlConversion: 'usd-quoted', demoPrice: 2400,
    },
    usdPair('frxEURUSD', 'EURUSD', 'Euro / US Dollar', 'usd-quoted', 1.08),
    usdPair('frxGBPUSD', 'GBPUSD', 'Pound / US Dollar', 'usd-quoted', 1.27),
    usdPair('frxAUDUSD', 'AUDUSD', 'Aussie / US Dollar', 'usd-quoted', 0.66),
    usdPair('frxNZDUSD', 'NZDUSD', 'Kiwi / US Dollar', 'usd-quoted', 0.6),
    usdPair('frxUSDJPY', 'USDJPY', 'US Dollar / Yen', 'usd-base', 150),
    usdPair('frxUSDCAD', 'USDCAD', 'US Dollar / Loonie', 'usd-base', 1.36),
    usdPair('frxUSDCHF', 'USDCHF', 'US Dollar / Franc', 'usd-base', 0.88),
    {
      symbol: 'WLDUSD', name: 'USD Basket Index', shortName: 'USD Basket', group: 'USD pairs',
      decimals: 3, pipSize: 0.001, contractSize: 1, minLot: 0.01, lotStep: 0.01,
      spread: 0.02, pnlConversion: 'usd-quoted', demoPrice: 100,
    },
  ];

  function synthetic(symbol, name, decimals, demoPrice, spread, contractSize = 1) {
    return {
      symbol, name, shortName: name.replace(' Index', ''), group: 'Deriv synthetics',
      decimals, pipSize: Math.pow(10, -decimals), contractSize, minLot: 0.001, lotStep: 0.001,
      spread, pnlConversion: 'usd-quoted', demoPrice,
    };
  }

  function usdPair(symbol, shortName, name, pnlConversion, demoPrice) {
    const isYen = shortName.endsWith('JPY');
    return {
      symbol, name, shortName, group: 'USD pairs',
      decimals: isYen ? 3 : 5, pipSize: isYen ? 0.01 : 0.0001, contractSize: 100000,
      minLot: 0.01, lotStep: 0.01, spread: isYen ? 0.012 : 0.00012, pnlConversion, demoPrice,
    };
  }

  function bySymbol(list, symbol) {
    const found = list.find((instrument) => instrument.symbol === symbol);
    if (!found) throw new Error(`Unknown instrument "${symbol}"`);
    return found;
  }

  /** Account-currency (USD) value of a one-price-unit move on one contract. */
  function usdPerPriceUnit(instrument, price) {
    return instrument.pnlConversion === 'usd-base' ? 1 / price : 1;
  }

  function formatPrice(instrument, price) {
    return Number(price).toFixed(instrument.decimals);
  }

  APA.instruments = { defaults: DEFAULT_INSTRUMENTS, bySymbol, usdPerPriceUnit, formatPrice };
})((globalThis.APA = globalThis.APA || {}));
