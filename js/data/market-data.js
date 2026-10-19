(function (APA) {
  'use strict';

  const STRUCTURE_CANDLES = 3000;
  const BIAS_CANDLES = 1500;

  /**
   * Picks the data source and hands out closed candles. "auto" tries Deriv and falls back to labelled demo
   * data if Deriv cannot be reached; "deriv" fails loudly instead. Add a new provider by giving it the same
   * connect / candles / subscribe methods (see DerivFeed) and choosing it in connect().
   */
  class MarketData {
    constructor(settings) {
      this.settings = settings;
      this.feed = null;
      this.csvFeed = null;
      this.status = { kind: 'connecting', label: 'Connecting…', detail: '' };
    }

    async connect() {
      const { source, derivEndpoint, derivAppId } = this.settings.data;
      const instruments = APA.settings.instruments(this.settings);
      if (source === 'demo') return this.use(new APA.DemoFeed(instruments), 'Demo data selected in Settings.');
      if (source === 'csv') {
        if (!this.csvFeed) throw new Error('Choose a CSV file in Settings → Data source first.');
        return this.use(this.csvFeed, 'Candles from your CSV file.');
      }
      const deriv = new APA.DerivFeed({ endpoint: derivEndpoint, appId: derivAppId });
      try {
        await deriv.connect();
        return this.use(deriv, 'Live candles from Deriv. Only closed candles are used for signals.');
      } catch (error) {
        if (source === 'deriv') throw error;
        console.warn('[market-data] Deriv unavailable, using demo data', error);
        return this.use(new APA.DemoFeed(instruments), `${error.message} Showing DEMO data instead; these are not market prices.`);
      }
    }

    use(feed, detail) {
      this.feed = feed;
      this.status = { kind: feed.kind, label: feed.label, detail };
      return this.status;
    }

    loadCsv(fileName, text) {
      this.csvFeed = new APA.CsvFeed(fileName, text);
      return this.csvFeed;
    }

    /** Entry, structure and bias candles for one instrument, with any still-forming candle removed. */
    async candleSet(symbol, strategy, entryCount = this.settings.data.candleCount) {
      const seconds = this.timeframeSeconds(strategy);
      const [entry, structure, bias] = await Promise.all([
        this.closedCandles(symbol, seconds.entry, entryCount),
        this.closedCandles(symbol, seconds.structure, STRUCTURE_CANDLES),
        this.closedCandles(symbol, seconds.bias, BIAS_CANDLES),
      ]);
      return { candleSets: { entry, structure, bias }, timeframeSeconds: seconds };
    }

    async closedCandles(symbol, seconds, count) {
      const candles = await this.feed.candles(symbol, seconds, count + 1);
      return APA.candles.closedOnly(candles, seconds, Math.floor(Date.now() / 1000));
    }

    async chartCandles(symbol, seconds, count = 1500) {
      return this.feed.candles(symbol, seconds, count);
    }

    subscribe(symbol, seconds, onCandle) {
      return this.feed.subscribe(symbol, seconds, onCandle);
    }

    timeframeSeconds(strategy) {
      return {
        entry: APA.timeframes.byKey(strategy.entryTimeframe).seconds,
        structure: APA.timeframes.byKey(strategy.structureTimeframe).seconds,
        bias: APA.timeframes.byKey(strategy.biasTimeframe).seconds,
      };
    }
  }

  APA.MarketData = MarketData;
})((globalThis.APA = globalThis.APA || {}));
