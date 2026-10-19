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
    chart: { showZones: true, showMarkers: true, showTradeLines: true, maxZonesShown: 8 },
    data: {
      source: 'auto',
      derivEndpoint: 'wss://ws.derivws.com/websockets/v3',
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
