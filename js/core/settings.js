(function (APA) {
  'use strict';

  const STORAGE_KEY = 'strategy-desk.settings.v1';

  // Every number here that the videos never stated is marked UNVERIFIED in docs/STRATEGY-RULES.md section 4.
  const DEFAULTS = {
    strategy: {
      structureTimeframe: '1h',
      biasTimeframe: '4h',
      entryTimeframe: '5m',
      swingStrength: 3,
      entrySwingStrength: 2,
      models: {
        qmInvalidation: true, invalidationX: true, newInvalidation: true,
        aFormation: true, vFormation: true, ocl: true, sbr: true, rbs: true,
      },
      followBias: {
        qmInvalidation: false, invalidationX: false, newInvalidation: false,
        aFormation: true, vFormation: false, ocl: true, sbr: true, rbs: true,
      },
      requireLiquiditySweep: true,
      confirmations: { engulfing: true, pinBar: true, lowerTimeframeChoch: true, doji: false, insideBar: false },
      tapToleranceRanges: 0.1,
      stopBufferRanges: 0.5,
      confirmWindowBars: 36,
      maxZoneAgeBars: 300,
      minRewardToRisk: 3,
      partialAtR: 3,
      partialFraction: 0.5,
      fallbackTargetR: 5,
      impulseBodyFactor: 1.2,
      minLevelTouches: 2,
      levelToleranceRanges: 0.25,
      oneTradeAtATime: true,
      freshSignalBars: 3,
    },
    risk: { balance: 10000, riskPercent: 1, maxRiskPercent: 2 },
    backtest: { slippagePrice: 0, commissionPerLot: 0, startingBalance: 10000 },
    // The first picture's markup is on by default. The older APA overlays stay available but start off, to avoid clutter.
    chart: {
      showApaZones: false, showApaMarkers: false, showApaTradeLines: false, maxZonesShown: 8,
      showDetails: true,
      showPotentialTrade: true,
      // The chart opens filling the window. "Exit full screen" or Esc returns to the normal page.
      fullView: true,
      markup: {
        bos: true, mss: true, fvg: true, ob: true, sweep: true,
        ifvg: false, breaker: false, ote: false, sd: false, sr: false, breakout: false, crt: false, silverBullet: false, powerOf3: false,
      },
    },
    // Alerts run on real Deriv prices only. With everything on, these four markets fired about 205 alerts a day on 15m,
    // so the most frequent concepts start muted (about 59 a day). Each one can be ticked on the Alerts page.
    alerts: {
      symbols: ['R_75', 'R_100', '1HZ100V', 'frxXAUUSD', 'frxEURUSD'],
      timeframe: '15m',
      concepts: {
        bos: false, mss: true, fvg: false, ob: true, sweep: false,
        ifvg: false, breaker: false, ote: true, sd: false, sr: false, breakout: true, crt: true, silverBullet: true, powerOf3: true,
      },
    },
    data: {
      source: 'auto',
      derivEndpoint: 'wss://red.derivws.com/websockets/v3', // ws.derivws.com returns HTTP 520 from this network
      derivAppId: '1089',
      candleCount: 5000,
    },
    instrumentOverrides: {},
    selected: { symbol: 'R_75', chartTimeframe: '1h' },
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeDeep(base, override) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
    const merged = Array.isArray(base) ? [...base] : { ...base };
    for (const [key, value] of Object.entries(override)) {
      const baseValue = base ? base[key] : undefined;
      merged[key] = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue)
        ? mergeDeep(baseValue, value) : value;
    }
    return merged;
  }

  function load() {
    return mergeDeep(clone(DEFAULTS), APA.storage.readJson(STORAGE_KEY));
  }

  function save(settings) {
    APA.storage.writeJson(STORAGE_KEY, settings);
  }

  function reset() {
    APA.storage.remove(STORAGE_KEY);
    return clone(DEFAULTS);
  }

  /** Instrument list with the user's edits from Settings applied on top of the defaults. */
  function instruments(settings) {
    return APA.instruments.defaults.map((instrument) => ({
      ...instrument, ...(settings.instrumentOverrides[instrument.symbol] || {}),
    }));
  }

  APA.settings = { defaults: () => clone(DEFAULTS), load, save, reset, instruments, mergeDeep };
})((globalThis.APA = globalThis.APA || {}));
