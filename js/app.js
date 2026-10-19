(function (APA) {
  'use strict';

  const { $, $$, escapeHtml, toast, segmented } = APA.ui;

  const NAVIGATION = [
    { group: 'Trade', items: [
      { view: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { view: 'chart', label: 'Chart', icon: 'chart' },
      { view: 'calculator', label: 'Position size', icon: 'calculator' },
      { view: 'checklist', label: 'Checklist', icon: 'checklist' },
    ] },
    { group: 'Review', items: [
      { view: 'journal', label: 'Journal', icon: 'journal' },
      { view: 'analytics', label: 'Analytics', icon: 'analytics' },
      { view: 'backtest', label: 'Backtest', icon: 'backtest' },
    ] },
    { group: 'Strategy', items: [
      { view: 'rules', label: 'Strategy rules', icon: 'rules' },
      { view: 'settings', label: 'Settings', icon: 'settings' },
    ] },
  ];

  const ENTRY_TIMEFRAMES = ['1m', '5m', '15m'];

  /** Holds shared state, loads candles, runs the strategy and tells the views when something changed. */
  class App {
    constructor() {
      this.settings = APA.settings.load();
      this.instruments = APA.settings.instruments(this.settings);
      this.market = new APA.MarketData(this.settings);
      this.journal = new APA.JournalStore();
      this.symbol = this.settings.selected.symbol;
      this.analysis = null;
      this.analysisError = null;
      this.isLoading = false;
      this.lastBacktest = null;
      this.calculatorDraft = null;
      this.listeners = new Map();
      this.views = {};
      this.currentView = null;
      this.stopStream = null;
      this.refreshTimer = null;
    }

    on(event, handler) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(handler);
    }

    emit(event, payload) {
      for (const handler of this.listeners.get(event) || []) {
        try { handler(payload); } catch (error) { console.error(`[app] ${event} handler failed`, error); }
      }
    }

    instrument(symbol = this.symbol) {
      return APA.instruments.bySymbol(this.instruments, symbol);
    }

    async start() {
      this.buildShell();
      for (const [name, view] of Object.entries(APA.views)) {
        this.views[name] = view;
        view.mount($(`.view[data-view="${name}"]`), this);
      }
      this.navigate(location.hash.slice(1) || 'dashboard');
      window.addEventListener('hashchange', () => this.navigate(location.hash.slice(1)));
      await this.connect();
    }

    async connect() {
      this.renderSource({ kind: 'connecting', label: 'Connecting…', detail: 'Opening the market data feed.' });
      try {
        this.renderSource(await this.market.connect());
      } catch (error) {
        this.renderSource({ kind: 'demo', label: 'No data', detail: error.message });
        toast(error.message, 'error');
        return;
      }
      await this.refresh();
    }

    /** Reloads candles for the selected market, re-runs the strategy and restarts the live stream. */
    async refresh() {
      if (this.isLoading) return;
      this.isLoading = true;
      this.emit('loading', true);
      const symbol = this.symbol;
      try {
        const { candleSets, timeframeSeconds } = await this.market.candleSet(symbol, this.settings.strategy);
        const simulation = APA.engine.run({
          instrument: this.instrument(symbol), strategy: this.settings.strategy, candleSets, timeframeSeconds,
          costs: this.settings.backtest,
        });
        if (symbol !== this.symbol) return;
        this.analysis = { symbol, simulation, signal: APA.signal.describe(simulation), candleSets, timeframeSeconds, loadedAt: Date.now() };
        this.analysisError = null;
        this.watchForClosedCandles(symbol, timeframeSeconds.entry, candleSets.entry);
      } catch (error) {
        console.error('[app] analysis failed', error);
        this.analysis = null;
        this.analysisError = error.message;
        toast(`Could not analyse ${this.instrument(symbol).shortName}: ${error.message}`, 'error');
      } finally {
        this.isLoading = false;
        this.emit('loading', false);
        this.emit('analysis', this.analysis);
      }
    }

    // A new candle opening means the previous one closed: that is the moment to re-run the strategy.
    watchForClosedCandles(symbol, entrySeconds, entryCandles) {
      if (this.stopStream) this.stopStream();
      const lastClosedOpen = entryCandles.length ? entryCandles[entryCandles.length - 1].time : 0;
      this.stopStream = this.market.subscribe(symbol, entrySeconds, (candle) => {
        this.emit('tick', candle);
        if (candle.time > lastClosedOpen + entrySeconds) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => this.refresh(), 1500);
        }
      });
    }

    async setSymbol(symbol) {
      if (symbol === this.symbol) return;
      this.symbol = symbol;
      this.settings.selected.symbol = symbol;
      APA.settings.save(this.settings);
      $('#symbolSelect').value = symbol;
      this.emit('symbol', symbol);
      await this.refresh();
    }

    async updateSettings(settings, { reconnect = false } = {}) {
      this.settings = settings;
      APA.settings.save(settings);
      this.instruments = APA.settings.instruments(settings);
      this.market.settings = settings;
      this.renderTimeframes();
      this.emit('settings', settings);
      if (reconnect) await this.connect(); else await this.refresh();
    }

    navigate(viewName) {
      const name = this.views[viewName] ? viewName : 'dashboard';
      if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
      this.currentView = name;
      $$('.view').forEach((section) => { section.hidden = section.dataset.view !== name; });
      $$('.nav-item').forEach((item) => item.setAttribute('aria-current', item.dataset.view === name ? 'page' : 'false'));
      const view = this.views[name];
      $('#viewTitle').textContent = view.title;
      $('#viewSubtitle').textContent = view.subtitle;
      this.closeMenu();
      if (view.show) view.show();
      window.scrollTo({ top: 0 });
    }

    openCalculatorWith(draft) {
      this.calculatorDraft = draft;
      this.navigate('calculator');
    }

    // ---------- shell ----------

    buildShell() {
      $('#nav').innerHTML = NAVIGATION.map((group) => `
        <div class="nav-group">${group.group}</div>
        ${group.items.map((item) => `<button class="nav-item" type="button" data-view="${item.view}">${APA.icons[item.icon]}<span>${item.label}</span></button>`).join('')}
      `).join('');
      $('#nav').addEventListener('click', (event) => {
        const item = event.target.closest('.nav-item');
        if (item) this.navigate(item.dataset.view);
      });

      $('#menuButton').innerHTML = APA.icons.menu;
      $('#menuButton').addEventListener('click', () => this.openMenu());
      $('#scrim').addEventListener('click', () => this.closeMenu());

      $('#symbolSelect').innerHTML = APA.ui.instrumentOptions(this.instruments, this.symbol);
      $('#symbolSelect').addEventListener('change', (event) => this.setSymbol(event.target.value));

      $('#refreshButton').innerHTML = `${APA.icons.refresh}<span>Refresh</span>`;
      $('#refreshButton').addEventListener('click', () => this.refresh());
      this.on('loading', (isLoading) => { $('#refreshButton').disabled = isLoading; });

      this.renderTimeframes();
      this.tickClock();
      setInterval(() => this.tickClock(), 1000);
    }

    renderTimeframes() {
      const strategy = this.settings.strategy;
      segmented($('#entryTimeframe'), ENTRY_TIMEFRAMES.map((key) => ({ value: key, label: APA.timeframes.byKey(key).label })),
        strategy.entryTimeframe, (value) => {
          const next = APA.settings.mergeDeep(this.settings, { strategy: { entryTimeframe: value } });
          this.updateSettings(next);
        });
      $('#timeframeStack').innerHTML = `<span><b>${APA.timeframes.byKey(strategy.structureTimeframe).label}</b> zones</span><span><b>${APA.timeframes.byKey(strategy.biasTimeframe).label}</b> bias &amp; targets</span>`;
    }

    renderSource(status) {
      this.sourceStatus = status;
      const badge = $('#sourceBadge');
      const text = { live: 'LIVE', demo: 'DEMO', csv: 'CSV', connecting: 'CONNECTING' }[status.kind] || 'OFFLINE';
      badge.className = `source-badge source-${status.kind}`;
      badge.innerHTML = `<span class="dot ${status.kind === 'live' ? 'dot-pulse' : ''}"></span>${text}`;
      badge.title = status.detail;
      $('#sourceCard').innerHTML = `<strong><span class="dot ${status.kind === 'live' ? 'bull' : status.kind === 'demo' ? 'wait' : ''}"></span>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.detail)}</p>`;
      const banner = $('#demoBanner');
      banner.hidden = status.kind !== 'demo';
      banner.innerHTML = `<strong>DEMO DATA</strong><span>${escapeHtml(status.detail)} Signals, charts and backtests below run on generated candles. Change the source in Settings → Data source.</span>`;
      this.emit('source', status);
    }

    tickClock() {
      $('#clock').textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
    }

    openMenu() {
      $('#sidebar').classList.add('is-open');
      $('#scrim').hidden = false;
      $('#menuButton').setAttribute('aria-expanded', 'true');
    }

    closeMenu() {
      $('#sidebar').classList.remove('is-open');
      $('#scrim').hidden = true;
      $('#menuButton').setAttribute('aria-expanded', 'false');
    }
  }

  APA.views = APA.views || {};
  document.addEventListener('DOMContentLoaded', () => {
    APA.app = new App();
    APA.app.start().catch((error) => {
      console.error('[app] start failed', error);
      toast(`The dashboard could not start: ${error.message}`, 'error');
    });
  });
})((globalThis.APA = globalThis.APA || {}));
