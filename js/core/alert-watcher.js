(function (APA) {
  'use strict';

  const CHECK_INTERVAL_MS = 30000;
  const HISTORY_CANDLES = 1000;
  const FRESH_EVENT_BARS = 3;

  /**
   * Checks the chosen markets on a timer and reports each setup once, when it first appears.
   * Everything already on the chart when watching begins is treated as old news, so opening the page stays quiet.
   */
  class AlertWatcher {
    constructor({ market, getConfig, onAlerts, onStatus, now = () => Math.floor(Date.now() / 1000) }) {
      this.market = market;
      this.getConfig = getConfig;
      this.onAlerts = onAlerts;
      this.onStatus = onStatus;
      this.now = now;
      this.marketStates = new Map();
      this.timer = null;
      this.isChecking = false;
    }

    /** Starts checking now, then again on every interval. */
    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.checkAllMarkets(), CHECK_INTERVAL_MS);
      this.checkAllMarkets();
    }

    /** Stops the timer. Anything remembered stays, so a restart does not repeat old alerts. */
    stop() {
      clearInterval(this.timer);
      this.timer = null;
    }

    /** Checks each market in turn. One failing market does not stop the others, and failures are reported. */
    async checkAllMarkets() {
      if (this.isChecking) return;
      this.isChecking = true;
      const config = this.getConfig();
      const failures = [];
      for (const symbol of config.symbols) {
        try {
          await this.checkMarket(symbol, config);
        } catch (error) {
          console.warn(`[alerts] ${symbol} check failed`, error);
          failures.push({ symbol, message: error.message });
        }
      }
      this.isChecking = false;
      this.onStatus({ checkedAt: this.now(), marketCount: config.symbols.length, failures });
    }

    /** Runs the full analysis only when a candle has closed. Otherwise it only compares the forming candle with the zones. */
    async checkMarket(symbol, config) {
      const seconds = APA.timeframes.byKey(config.timeframe).seconds;
      const key = `${symbol}:${config.timeframe}`;
      const latest = await this.market.chartCandles(symbol, seconds, 1);
      const forming = latest[latest.length - 1];
      if (!forming) throw new Error('Deriv returned no candles.');

      const previous = this.marketStates.get(key);
      const isFirstLook = !previous;
      const state = previous && previous.barTime === forming.time ? previous : await this.analyzeMarket(symbol, seconds, forming, previous);
      this.marketStates.set(key, state);

      const candidates = [...state.analysis.events, ...APA.smartMoney.liveTouches(state.analysis, forming)];
      const fresh = this.takeNewEvents(candidates, state, config, seconds, isFirstLook);
      if (fresh.length) this.onAlerts(fresh.map((event) => ({ ...event, symbol, timeframe: config.timeframe })));
    }

    /** Downloads closed candles and analyses them, keeping the memory of what has already been reported. */
    async analyzeMarket(symbol, seconds, forming, previous) {
      const candles = await this.market.closedCandles(symbol, seconds, HISTORY_CANDLES);
      return {
        barTime: forming.time,
        analysis: APA.smartMoney.analyze(candles, { timeframeSeconds: seconds }),
        seenIds: previous ? previous.seenIds : new Set(),
      };
    }

    /** Returns events not reported before. Each one is remembered even if muted, so unmuting does not replay old ones. */
    takeNewEvents(candidates, state, config, seconds, isFirstLook) {
      const oldestFreshTime = this.now() - seconds * FRESH_EVENT_BARS;
      const fresh = [];
      for (const event of candidates) {
        if (state.seenIds.has(event.id)) continue;
        state.seenIds.add(event.id);
        if (!isFirstLook && event.time >= oldestFreshTime && config.concepts[event.concept]) fresh.push(event);
      }
      return fresh;
    }
  }

  APA.AlertWatcher = AlertWatcher;
})((globalThis.APA = globalThis.APA || {}));
