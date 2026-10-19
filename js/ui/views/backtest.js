(function (APA) {
  'use strict';

  const { $, escapeHtml, format, toneOf, emptyState, showFieldError, clearFieldErrors, numberFrom } = APA.ui;
  const panels = APA.performancePanels;
  const CANDLE_COUNTS = [2000, 5000, 10000, 20000];

  const view = {
    title: 'Backtest',
    subtitle: 'Replay the APA rules over historical candles, with costs',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.equity = { chart: null };
      this.running = false;
      this.allMarkets = null;
      section.innerHTML = `
        <form class="panel" data-slot="form" novalidate>
          <div class="panel-head"><div><h2>${APA.icons.backtest}Backtest settings</h2><p>Strategy parameters come from Settings → Strategy.</p></div></div>
          <div class="form-grid">
            <label class="field span-2"><span>Instrument</span><select name="symbol"></select></label>
            <label class="field"><span>Entry candles</span><select name="candles">${CANDLE_COUNTS.map((count) => `<option value="${count}">${count.toLocaleString()}</option>`).join('')}</select><small data-slot="span"></small></label>
            <label class="field"><span>Spread (price units)</span><input name="spread" type="number" step="any" min="0"></label>
            <label class="field"><span>Slippage per fill (price)</span><input name="slippage" type="number" step="any" min="0"></label>
            <label class="field"><span>Commission per lot (USD)</span><input name="commission" type="number" step="any" min="0"></label>
            <label class="field"><span>Starting balance (USD)</span><input name="balance" type="number" step="any" min="0"></label>
            <label class="field"><span>Risk per trade (%)</span><input name="riskPercent" type="number" step="0.1" min="0"></label>
          </div>
          <div class="form-actions" style="margin-top:16px">
            <button class="button" type="submit" data-slot="run">${APA.icons.play}Run backtest</button>
            <button class="button button-ghost" type="button" data-action="all">${APA.icons.radar}Run on every market</button>
            <span class="muted" data-slot="progress-text"></span>
          </div>
          <div class="progress" data-slot="progress" hidden style="margin-top:12px"><div style="width:0"></div></div>
        </form>
        <div data-slot="results"></div>
        <div class="panel" data-slot="all" hidden></div>
        <div class="panel"><div class="panel-head"><h3>${APA.icons.shield}How the replay avoids cheating</h3></div>
          <div class="explain"><p>Only closed candles are used. A swing counts only after the candles that confirm it have closed, and a zone appears only once its break candle has closed. Entries happen at the close of the confirmation candle. Each zone trades at most once, and only one trade is open at a time. When one candle touches both the stop and the target, the stop is assumed to come first. Costs (spread + slippage on both fills + commission) come off every trade.</p></div></div>`;
      this.form = $('[data-slot="form"]', section);
      this.form.addEventListener('submit', (event) => { event.preventDefault(); this.runSelected(); });
      this.form.elements.symbol.addEventListener('change', () => this.applyInstrument());
      this.form.elements.candles.addEventListener('change', () => this.describeSpan());
      section.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'all') this.runAll();
        if (action.dataset.action === 'pick') { this.form.elements.symbol.value = action.dataset.symbol; this.applyInstrument(); this.runSelected(); }
      });
      app.on('settings', () => this.resetForm());
      app.on('symbol', (symbol) => { if (!this.running) { this.form.elements.symbol.value = symbol; this.applyInstrument(); } });
      this.resetForm();
    },

    show() { this.renderResults(); this.describeSpan(); },

    resetForm() {
      const { settings } = this.app;
      this.form.elements.symbol.innerHTML = APA.ui.instrumentOptions(this.app.instruments, this.app.symbol);
      this.form.elements.candles.value = String(CANDLE_COUNTS.includes(settings.data.candleCount) ? settings.data.candleCount : 5000);
      this.form.elements.slippage.value = settings.backtest.slippagePrice;
      this.form.elements.commission.value = settings.backtest.commissionPerLot;
      this.form.elements.balance.value = settings.backtest.startingBalance;
      this.form.elements.riskPercent.value = settings.risk.riskPercent;
      this.applyInstrument();
    },

    applyInstrument() {
      const instrument = APA.instruments.bySymbol(this.app.instruments, this.form.elements.symbol.value);
      this.form.elements.spread.value = instrument.spread;
      this.describeSpan();
    },

    describeSpan() {
      const seconds = APA.timeframes.byKey(this.app.settings.strategy.entryTimeframe).seconds;
      const days = (Number(this.form.elements.candles.value) * seconds) / 86400;
      $('[data-slot="span"]', this.section).textContent = `≈ ${days < 2 ? `${(days * 24).toFixed(0)} hours` : `${days.toFixed(0)} days`} of ${this.app.settings.strategy.entryTimeframe} candles`;
    },

    readForm() {
      clearFieldErrors(this.form);
      const values = {
        spread: numberFrom(this.form, 'spread'), slippage: numberFrom(this.form, 'slippage'), commission: numberFrom(this.form, 'commission'),
        balance: numberFrom(this.form, 'balance'), riskPercent: numberFrom(this.form, 'riskPercent'),
      };
      const rules = [
        ['spread', values.spread >= 0, 'Spread must be 0 or more.'],
        ['slippage', values.slippage >= 0, 'Slippage must be 0 or more.'],
        ['commission', values.commission >= 0, 'Commission must be 0 or more.'],
        ['balance', values.balance > 0, 'Starting balance must be above 0.'],
        ['riskPercent', values.riskPercent > 0 && values.riskPercent <= 100, 'Risk % must be between 0 and 100.'],
      ];
      const broken = rules.find(([, ok]) => !ok);
      if (broken) { showFieldError(this.form, broken[0], broken[2]); return null; }
      return { ...values, candles: Number(this.form.elements.candles.value) };
    },

    async backtest(instrumentBase, options) {
      const instrument = { ...instrumentBase, spread: options.spread ?? instrumentBase.spread };
      const { candleSets, timeframeSeconds } = await this.app.market.candleSet(instrument.symbol, this.app.settings.strategy, options.candles);
      const simulation = APA.engine.run({
        instrument, strategy: this.app.settings.strategy, candleSets, timeframeSeconds,
        costs: { slippagePrice: options.slippage, commissionPerLot: options.commission },
      });
      const results = APA.performance.fromBacktestTrades(simulation.trades, options.balance, options.riskPercent);
      const entry = candleSets.entry;
      const source = this.app.market.status;
      const period = `${format.date(entry[0].time)} → ${format.date(entry[entry.length - 1].time)}`;
      return {
        instrument, simulation, results, startingBalance: options.balance,
        summary: APA.performance.summarize(results, options.balance),
        label: `Backtest · ${instrument.shortName} · ${source.kind === 'live' ? 'Deriv history' : source.kind === 'demo' ? 'DEMO data (not real prices)' : source.label} · ${period}`,
      };
    },

    setRunning(running, text = '') {
      this.running = running;
      $('[data-slot="run"]', this.section).disabled = running;
      $('[data-action="all"]', this.section).disabled = running;
      $('[data-slot="progress-text"]', this.section).innerHTML = running ? `<span class="spinner"></span>${escapeHtml(text)}` : '';
    },

    async runSelected() {
      const options = this.readForm();
      if (!options || this.running) return;
      const instrument = APA.instruments.bySymbol(this.app.instruments, this.form.elements.symbol.value);
      this.setRunning(true, `Loading ${instrument.shortName} history and replaying…`);
      try {
        this.app.lastBacktest = await this.backtest(instrument, options);
        this.app.emit('backtest');
        APA.ui.toast(`Backtest finished: ${this.app.lastBacktest.summary.count} closed trades.`);
      } catch (error) {
        APA.ui.toast(`Backtest failed: ${error.message}`, 'error');
      } finally {
        this.setRunning(false);
        this.renderResults();
      }
    },

    async runAll() {
      const options = this.readForm();
      if (!options || this.running) return;
      const instruments = this.app.instruments;
      const bar = $('[data-slot="progress"]', this.section);
      bar.hidden = false;
      this.allMarkets = [];
      for (const [index, instrument] of instruments.entries()) {
        this.setRunning(true, `${instrument.shortName} (${index + 1}/${instruments.length})…`);
        try {
          const run = await this.backtest(instrument, { ...options, spread: instrument.spread });
          this.allMarkets.push({ instrument, summary: run.summary, label: run.label });
        } catch (error) {
          this.allMarkets.push({ instrument, error: error.message });
        }
        $('div', bar).style.width = `${((index + 1) / instruments.length) * 100}%`;
        this.renderAllMarkets();
      }
      bar.hidden = true;
      this.setRunning(false);
      APA.ui.toast(`Backtested ${instruments.length} markets.`);
    },

    renderAllMarkets() {
      const slot = $('[data-slot="all"]', this.section);
      slot.hidden = !this.allMarkets;
      if (!this.allMarkets) return;
      const rows = this.allMarkets.slice().sort((first, second) => (second.summary ? second.summary.totalR ?? 0 : -999) - (first.summary ? first.summary.totalR ?? 0 : -999));
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.radar}Every market</h2><p>"Not every pair respects every structure" (V2 24:27). Click a row for its full report.</p></div></div>
        <div class="table-wrap"><table><thead><tr><th>Market</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Profit factor</th><th class="num">Total R</th><th class="num">Net</th><th class="num">Max DD</th></tr></thead><tbody>
          ${rows.map((row) => row.error
            ? `<tr><td>${escapeHtml(row.instrument.shortName)}</td><td colspan="6" class="muted">${escapeHtml(row.error)}</td></tr>`
            : `<tr class="is-clickable" data-action="pick" data-symbol="${row.instrument.symbol}"><td>${escapeHtml(row.instrument.shortName)}</td><td class="num">${row.summary.count}</td>
              <td class="num">${row.summary.count ? format.percent(row.summary.winRate) : '—'}</td><td class="num">${row.summary.count ? format.profitFactor(row.summary.profitFactor) : '—'}</td>
              <td class="num ${toneOf(row.summary.totalR)}">${format.r(row.summary.totalR ?? 0)}</td><td class="num ${toneOf(row.summary.net)}">${format.signedMoney(row.summary.net)}</td>
              <td class="num">${row.summary.maxDrawdownPercent.toFixed(1)}%</td></tr>`).join('')}
        </tbody></table></div>`;
    },

    renderResults() {
      const slot = $('[data-slot="results"]', this.section);
      const run = this.app.lastBacktest;
      if (!run) {
        slot.innerHTML = `<div class="panel">${emptyState('No backtest yet', 'Pick a market and press Run. Results stay here and in Analytics until you reload the page.', 'backtest')}</div>`;
        return;
      }
      const { summary, simulation, instrument } = run;
      slot.innerHTML = `
        <div class="grid" style="gap:18px">
          <div class="panel">
            <div class="panel-head"><div><h2>${APA.icons.zap}Results</h2><p>No profit is claimed beyond these numbers.</p></div><span class="source-label">${APA.icons.backtest}${escapeHtml(run.label)}</span></div>
            ${panels.statGrid(summary)}
            ${summary.count < 30 ? `<div class="note" style="margin-top:12px"><strong>Small sample:</strong> ${summary.count} closed trades is too few to judge the strategy. Load more candles or run on every market.</div>` : ''}
          </div>
          <div class="grid grid-2">
            <div class="panel"><div class="panel-head"><h2>${APA.icons.analytics}Equity curve</h2></div><div class="chart-box equity" data-slot="equity"></div></div>
            <div class="panel"><div class="panel-head"><h2>${APA.icons.layers}By entry model</h2></div>${panels.groupTable(APA.performance.groupBy(run.results, 'model', run.startingBalance))}</div>
          </div>
          <div class="panel"><div class="panel-head"><div><h2>${APA.icons.journal}Every trade</h2><p>${simulation.trades.length} signals · ${simulation.states.filter((state) => state.status === 'skipped').length} zones skipped by the rules</p></div></div>
            ${simulation.trades.length ? `<div class="table-wrap"><table><thead><tr><th>Entry (candle close)</th><th>Model</th><th>Side</th><th>Confirmation</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Target</th><th class="num">Planned R:R</th><th>Exit</th><th class="num">Net R</th></tr></thead><tbody>
              ${simulation.trades.slice().reverse().map((trade) => `<tr><td>${format.time(trade.entryTime)}</td><td>${escapeHtml(APA.zones.model(trade.model).name)}</td>
                <td class="${trade.direction === 'buy' ? 'bull' : 'bear'}">${trade.direction === 'buy' ? 'Buy' : 'Sell'}</td><td>${escapeHtml(trade.confirmation)}</td>
                <td class="num">${format.price(instrument, trade.entry)}</td><td class="num">${format.price(instrument, trade.initialStop)}</td><td class="num">${format.price(instrument, trade.target)}</td>
                <td class="num">${format.ratio(trade.rewardToRisk)}</td><td>${trade.status === 'open' ? '<span class="tag tag-accent">Still open</span>' : escapeHtml(trade.exitReason)}</td>
                <td class="num ${toneOf(trade.netR)}">${trade.status === 'open' ? '—' : format.r(trade.netR)}</td></tr>`).join('')}
            </tbody></table></div>` : emptyState('No trades', 'The rules found no confirmed setups in this period.', 'zap')}</div>
        </div>`;
      panels.drawEquity($('[data-slot="equity"]', slot), this.equity, summary, run.startingBalance);
    },
  };

  APA.views = APA.views || {};
  APA.views.backtest = view;
})((globalThis.APA = globalThis.APA || {}));
