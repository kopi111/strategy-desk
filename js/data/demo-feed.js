(function (APA) {
  'use strict';

  const BASE_SECONDS = 60;
  const DEMO_DAYS = 60;

  /**
   * Made-up candles for when no market feed is reachable. Deterministic per symbol (seeded), with trending and
   * ranging regimes so structure forms. The UI labels everything from here as DEMO — these are not prices.
   */
  class DemoFeed {
    constructor(instruments) {
      this.kind = 'demo';
      this.label = 'Demo data';
      this.instruments = instruments;
      this.cache = new Map();
    }

    async connect() {}

    async candles(symbol, seconds, count) {
      if (seconds < BASE_SECONDS) throw new Error('Demo data starts at 1-minute candles.');
      const base = this.baseSeries(symbol);
      const series = seconds === BASE_SECONDS ? base : APA.candles.resample(base, seconds);
      return series.slice(-count);
    }

    subscribe() {
      return () => {};
    }

    baseSeries(symbol) {
      if (!this.cache.has(symbol)) {
        const instrument = APA.instruments.bySymbol(this.instruments, symbol);
        this.cache.set(symbol, generate(instrument, seedFrom(symbol)));
      }
      return this.cache.get(symbol);
    }
  }

  function generate(instrument, seed) {
    const random = mulberry32(seed);
    const gaussian = () => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
    const total = (DEMO_DAYS * 86400) / BASE_SECONDS;
    const end = Math.floor(Date.now() / 1000 / BASE_SECONDS) * BASE_SECONDS;
    const decimals = instrument.decimals;
    const baseVolatility = 0.00045;
    const candles = new Array(total);

    let price = instrument.demoPrice;
    let drift = 0;
    let volatility = baseVolatility;
    let regimeLeft = 0;
    for (let index = 0; index < total; index++) {
      if (regimeLeft-- <= 0) {
        regimeLeft = 300 + Math.floor(random() * 2400);
        drift = (random() - 0.5) * baseVolatility * 0.04;
      }
      volatility = Math.max(baseVolatility * 0.4, Math.min(baseVolatility * 2.5, volatility * (1 + gaussian() * 0.04)));
      const open = price;
      const close = open * Math.exp(drift + volatility * gaussian());
      const high = Math.max(open, close) * (1 + Math.abs(gaussian()) * volatility * 0.6);
      const low = Math.min(open, close) * (1 - Math.abs(gaussian()) * volatility * 0.6);
      candles[index] = {
        time: end - (total - index) * BASE_SECONDS,
        open: round(open, decimals), high: round(high, decimals), low: round(low, decimals), close: round(close, decimals),
      };
      price = close;
    }
    return candles;
  }

  function round(value, decimals) {
    return Number(value.toFixed(decimals));
  }

  function seedFrom(text) {
    let hash = 2166136261;
    for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  APA.DemoFeed = DemoFeed;
})((globalThis.APA = globalThis.APA || {}));
