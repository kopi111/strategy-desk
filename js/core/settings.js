(function (APA) {
  'use strict';

  const STORAGE_KEY = 'strategy-desk.settings.v1';

  // Deriv's public price feed. The new address comes first; the old ones are kept as backups.
  // Since 2026-11-24 the old addresses answer HTTP 520, so they are only tried if the new one fails.
  const DERIV_PUBLIC_ENDPOINT = 'wss://api.derivws.com/trading/v1/options/ws/public';
  const DERIV_BACKUP_ENDPOINTS = ['wss://red.derivws.com/websockets/v3', 'wss://ws.derivws.com/websockets/v3'];

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
      // APA 15m setup + 5m confirmation: potential buys/sells on the chart. 'profit' = 2R target, 'winRate' = 0.75R target.
      showApaConfirm: true,
      apaConfirmMode: 'profit',
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
      derivEndpoint: DERIV_PUBLIC_ENDPOINT,
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

  /** This function loads the saved settings on top of the defaults. */
  function load() {
    return moveOffOldDerivAddress(mergeDeep(clone(DEFAULTS), APA.storage.readJson(STORAGE_KEY)));
  }

  /** This function swaps an old saved Deriv address for the new one, so old browsers do not stay on DEMO. */
  function moveOffOldDerivAddress(settings) {
    if (DERIV_BACKUP_ENDPOINTS.includes(settings.data.derivEndpoint)) settings.data.derivEndpoint = DERIV_PUBLIC_ENDPOINT;
    return settings;
  }

  /** This function lists the Deriv addresses to try, the chosen one first, without repeats. */
  function derivEndpoints(settings) {
    return [...new Set([settings.data.derivEndpoint, DERIV_PUBLIC_ENDPOINT, ...DERIV_BACKUP_ENDPOINTS])];
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

  APA.settings = { defaults: () => clone(DEFAULTS), load, save, reset, instruments, mergeDeep, derivEndpoints };
})((globalThis.APA = globalThis.APA || {}));
