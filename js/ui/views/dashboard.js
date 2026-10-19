(function (APA) {
  'use strict';

  const { $, escapeHtml, format, toneOf, trendTone, emptyState, loading } = APA.ui;

  const STATUS_TONE = { BUY: 'buy', SELL: 'sell', WAIT: 'wait', 'NO TRADE': 'none' };
  const STATUS_CAPTION = { BUY: 'long', SELL: 'short', WAIT: 'stand by', 'NO TRADE': 'stay out' };
  const MARK = { pass: ['mark-pass', 'check'], fail: ['mark-fail', 'cross'], pending: ['mark-pending', 'clock'], 'n/a': ['mark-na', 'dash'] };

  const view = {
    title: 'Dashboard',
    subtitle: 'Live APA signal, checklist and account at a glance',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.scan = { running: false, rows: [], progress: 0 };
      section.innerHTML = `
        <div class="grid grid-kpi" data-slot="kpis"></div>
        <div class="grid grid-hero">
          <div class="panel signal-hero" data-slot="signal"></div>
          <div class="panel" data-slot="checklist"></div>
        </div>
        <div class="grid grid-2">
          <div class="panel" data-slot="ml-reading"></div>
          <div class="panel" data-slot="ml-test"></div>
        </div>
        <div class="grid grid-3">
          <div class="panel" data-slot="zones"></div>
          <div class="panel" data-slot="scanner"></div>
          <div class="panel" data-slot="history"></div>
        </div>
        <div class="grid grid-2">
          <div class="panel" data-slot="open"></div>
          <div class="panel" data-slot="journal"></div>
        </div>`;
      section.addEventListener('click', (event) => this.handleClick(event));
      for (const event of ['analysis', 'loading', 'journal', 'settings', 'source']) app.on(event, () => this.render());
      this.mlPanel = new APA.MlPanel(this.slot('ml-reading'), this.slot('ml-test'), app);
      app.on('analysis', () => this.mlPanel.refresh());
      this.render();
      this.mlPanel.render();
    },

    show() { this.render(); },

    slot(name) { return $(`[data-slot="${name}"]`, this.section); },

    render() {
      this.renderKpis();
      this.renderSignal();
      this.renderChecklist();
      this.renderZones();
      this.renderScanner();
      this.renderHistory();
      this.renderJournal();
    },

    renderKpis() {
      const { settings, journal, analysis } = this.app;
      const results = journal.results();
      const summary = APA.performance.summarize(results, settings.risk.balance);
      const todayStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
      const today = results.filter((result) => result.time >= todayStart);
      const todayPnl = today.reduce((total, result) => total + result.pnl, 0);
      const riskCash = settings.risk.balance * settings.risk.riskPercent / 100;
      const signal = analysis && analysis.signal;
      const cards = [
        ['Account balance', format.money(settings.risk.balance + summary.net), `Start ${format.money(settings.risk.balance)} + journal`, ''],
        ["Today's P&L", format.signedMoney(todayPnl), `${today.length} journal trade${today.length === 1 ? '' : 's'} closed today`, toneOf(todayPnl)],
        ['Win rate', summary.count ? format.percent(summary.winRate) : '—', `${summary.count} closed journal trades`, ''],
        ['Risk per trade', `${settings.risk.riskPercent}%`, `${format.money(riskCash)} · cap ${settings.risk.maxRiskPercent}%`, settings.risk.riskPercent > settings.risk.maxRiskPercent ? 'bear' : ''],
        ['Min reward : risk', `1:${settings.strategy.minRewardToRisk}`, `TP1 at ${settings.strategy.partialAtR}R, close ${settings.strategy.partialFraction * 100}%`, ''],
        ['Bias', signal ? format.trend(signal.biasTrend) : '—', signal ? `${APA.timeframes.byKey(settings.strategy.biasTimeframe).label} · ${APA.timeframes.byKey(settings.strategy.structureTimeframe).label} is ${format.trend(signal.structureTrend).toLowerCase()}` : 'Waiting for candles', signal ? trendTone(signal.biasTrend) : ''],
      ];
      this.slot('kpis').innerHTML = cards.map(([label, value, sub, tone]) => `
        <div class="panel kpi"><span class="kpi-label">${label}</span><span class="kpi-value ${tone}">${escapeHtml(value)}</span><span class="kpi-sub">${escapeHtml(sub)}</span></div>`).join('');
    },

    renderSignal() {
      const { analysis, analysisError, isLoading } = this.app;
      const instrument = this.app.instrument();
      const slot = this.slot('signal');
      if (!analysis) {
        slot.innerHTML = `<div class="signal-top">${analysisError
          ? emptyState('No signal', analysisError)
          : loading(isLoading ? `Loading ${instrument.shortName} candles and replaying the strategy…` : 'Connecting to the data feed…')}</div>`;
        return;
      }
      const { signal, timeframeSeconds } = analysis;
      const plan = signal.plan;
      const tone = STATUS_TONE[signal.status];
      const isDemo = this.app.sourceStatus && this.app.sourceStatus.kind === 'demo';
      const model = signal.focus ? APA.zones.model(signal.focus.zone.model) : null;
      const planCells = plan ? [
        ['Entry', format.price(instrument, plan.entry)],
        ['Stop loss', format.price(instrument, plan.initialStop ?? plan.stop)],
        [`TP1 (${this.app.settings.strategy.partialFraction * 100}%)`, plan.ok === false ? '—' : format.price(instrument, plan.partialTarget)],
        ['Final target', plan.ok === false ? '—' : format.price(instrument, plan.target)],
        ['Reward : risk', format.ratio(plan.rewardToRisk)],
        ['Plan', plan.kind === 'active' ? 'Active trade' : plan.ok === false ? 'Fails rules' : 'If confirmed'],
      ] : [['Entry', '—'], ['Stop loss', '—'], ['TP1', '—'], ['Final target', '—'], ['Reward : risk', '—'], ['Plan', 'None']];

      slot.innerHTML = `
        <div class="signal-top">
          <div class="signal-ring tone-${tone}" role="img" aria-label="Signal ${signal.status}"><div><strong>${signal.status}</strong><span>${STATUS_CAPTION[signal.status]}</span></div></div>
          <div class="signal-copy">
            <div class="signal-tags">
              ${isDemo ? '<span class="tag tag-wait">DEMO DATA</span>' : ''}
              ${signal.isFreshSignal ? '<span class="tag tag-accent">NEW</span>' : ''}
              ${model ? `<span class="tag">${escapeHtml(model.name)}</span>` : ''}
              <span class="tag">${APA.timeframes.bySeconds(timeframeSeconds.entry).label} entry</span>
              <span class="tag tag-${trendTone(signal.biasTrend)}">${format.trend(signal.biasTrend)} bias</span>
            </div>
            <h2>${escapeHtml(instrument.shortName)} <span class="price">${format.price(instrument, signal.lastClose)}</span></h2>
            <p>${escapeHtml(signal.headline)}</p>
            <small class="muted">As of the candle that closed ${format.time(signal.now)}. Forming candles are never used.</small>
          </div>
        </div>
        <div class="plan-grid">${planCells.map(([label, value]) => `<div class="plan-cell"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
        <div class="signal-actions">
          <button class="button button-small" data-action="chart">${APA.icons.chart}Open chart</button>
          <button class="button button-ghost button-small" data-action="size" ${plan && plan.ok !== false ? '' : 'disabled'}>${APA.icons.calculator}Size this trade</button>
          <button class="button button-ghost button-small" data-action="log" ${plan && plan.ok !== false ? '' : 'disabled'}>${APA.icons.journal}Log in journal</button>
          ${plan && plan.ok === false ? `<span class="muted">${escapeHtml(plan.reason)}</span>` : ''}
        </div>`;
    },

    renderChecklist() {
      const slot = this.slot('checklist');
      const signal = this.app.analysis && this.app.analysis.signal;
      if (!signal) { slot.innerHTML = `<div class="panel-head"><h2>${APA.icons.checklist}Strategy checklist</h2></div>${loading('Waiting for the strategy run…')}`; return; }
      const valid = APA.signal.isSetupValid(signal.checklist) && signal.status !== 'NO TRADE';
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.checklist}Strategy checklist</h2><p>Checked automatically on closed candles</p></div></div>
        <ul class="checklist">${signal.checklist.map((entry) => {
          const [className, icon] = MARK[entry.result];
          return `<li><span class="mark ${className}" aria-label="${entry.result}">${APA.icons[icon]}</span><div><strong>${escapeHtml(entry.label)}${entry.mandatory ? '' : '<span class="optional">optional</span>'}</strong><small>${escapeHtml(entry.detail)}</small></div></li>`;
        }).join('')}</ul>
        <div class="setup-state ${valid ? 'setup-valid' : 'setup-invalid'}">${valid ? APA.icons.check : APA.icons.clock}
          ${valid ? 'All mandatory conditions pass.' : `Not a valid setup yet: ${signal.checklist.filter((entry) => entry.mandatory && entry.result !== 'pass' && entry.result !== 'n/a').length} mandatory condition(s) open.`}</div>`;
    },

    renderZones() {
      const slot = this.slot('zones');
      const analysis = this.app.analysis;
      const instrument = this.app.instrument();
      const zones = analysis ? analysis.signal.liveZones.slice(0, 6) : [];
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.layers}Active zones</h2><p>Levels still waiting for price</p></div><span class="tag">${analysis ? analysis.signal.liveZones.length : 0}</span></div>
        ${zones.length ? `<ul class="zone-list">${zones.map((state) => `
          <li data-action="zone" data-time="${state.zone.sourceTime}" tabindex="0">
            <span class="bar ${state.zone.direction}"></span>
            <div><strong>${escapeHtml(APA.zones.model(state.zone.model).name)}</strong><small>${state.zone.direction === 'buy' ? 'Buy' : 'Sell'} at ${format.price(instrument, state.zone.level)} · ${APA.signal.distanceInRanges(analysis.simulation, state).toFixed(1)} candle ranges away</small></div>
            <span class="tag ${state.status === 'tapped' ? 'tag-wait' : ''}">${state.status === 'tapped' ? 'At level' : 'Waiting'}</span>
          </li>`).join('')}</ul>` : emptyState('No active zones', analysis ? 'Every recent level was used, broken or expired. New ones appear after the next break of structure.' : 'Zones appear once candles load.')}`;
    },

    renderScanner() {
      const slot = this.slot('scanner');
      const { rows, running, progress } = this.scan;
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.radar}Market scanner</h2><p>Deriv synthetics, XAUUSD and USD pairs</p></div>
          <button class="button button-ghost button-small" data-action="scan" ${running ? 'disabled' : ''}>${running ? 'Scanning…' : 'Scan all'}</button></div>
        ${running ? `<div class="progress" aria-label="Scan progress"><div style="width:${progress}%"></div></div>` : ''}
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Market</th><th>Bias</th><th>Signal</th></tr></thead><tbody>
          ${rows.map((row) => `<tr class="is-clickable" data-action="pick" data-symbol="${row.symbol}"><td>${escapeHtml(row.name)}</td>
            <td>${row.error ? '<span class="muted">—</span>' : `<span class="${trendTone(row.bias)}">${format.trend(row.bias)}</span>`}</td>
            <td>${row.error ? `<span class="muted" title="${escapeHtml(row.error)}">Error</span>` : `<span class="tag tag-${{ BUY: 'bull', SELL: 'bear', WAIT: 'wait' }[row.status] || ''}">${row.status}</span>`}</td></tr>`).join('')}
          </tbody></table></div>` : running ? '' : emptyState('Not scanned yet', 'Runs the same rules on every market and lists BUY / SELL / WAIT / NO TRADE. Takes a few seconds per market.', 'radar')}`;
    },

    renderHistory() {
      const slot = this.slot('history');
      const analysis = this.app.analysis;
      const instrument = this.app.instrument();
      const trades = analysis ? analysis.simulation.trades.slice(-7).reverse() : [];
      const first = analysis && analysis.candleSets.entry[0];
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.zap}Recent signals</h2><p>${first ? `Strategy replay since ${format.date(first.time)}` : 'Strategy replay'}</p></div></div>
        ${trades.length ? `<div class="table-wrap"><table><thead><tr><th>Closed candle</th><th>Setup</th><th class="num">Entry</th><th class="num">Result</th></tr></thead><tbody>
          ${trades.map((trade) => `<tr class="is-clickable" data-action="zone" data-time="${trade.entryTime}"><td>${format.time(trade.entryTime)}</td>
            <td><span class="${trade.direction === 'buy' ? 'bull' : 'bear'}">${trade.direction === 'buy' ? '▲' : '▼'}</span> ${escapeHtml(APA.zones.model(trade.model).name)}</td>
            <td class="num">${format.price(instrument, trade.entry)}</td>
            <td class="num ${toneOf(trade.netR)}">${trade.status === 'open' ? '<span class="tag tag-accent">OPEN</span>' : format.r(trade.netR)}</td></tr>`).join('')}
          </tbody></table></div>` : emptyState('No signals in this window', 'The strategy is selective: it waits for a tap, liquidity and a confirmation.', 'zap')}`;
    },

    renderJournal() {
      const { journal } = this.app;
      const openEntries = journal.open().slice(0, 6);
      const closedEntries = journal.all().filter((entry) => !openEntries.includes(entry) && Number.isFinite(entry.pnl)).slice(0, 6);
      this.slot('open').innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.target}Open positions</h2><p>Journal trades without an exit</p></div><span class="tag">${journal.open().length}</span></div>
        ${openEntries.length ? journalTable(openEntries, this.app, false) : emptyState('No open positions', 'Trades you log without an exit price show here.', 'target')}`;
      this.slot('journal').innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.journal}Trade history</h2><p>Latest closed journal trades</p></div><button class="button button-ghost button-small" data-action="journal">Open journal</button></div>
        ${closedEntries.length ? journalTable(closedEntries, this.app, true) : emptyState('No trades logged', 'Log trades in the Journal to track win rate and P&L here.', 'journal')}`;
    },

    async handleClick(event) {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      const signal = this.app.analysis && this.app.analysis.signal;
      if (action === 'chart') this.app.navigate('chart');
      if (action === 'journal') this.app.navigate('journal');
      if (action === 'zone') { this.app.chartFocusTime = Number(target.dataset.time); this.app.navigate('chart'); }
      if (action === 'size' && signal && signal.plan) this.app.openCalculatorWith(planDraft(signal.plan, this.app));
      if (action === 'log' && signal && signal.plan) { this.app.journalDraft = planDraft(signal.plan, this.app); this.app.navigate('journal'); }
      if (action === 'pick') this.app.setSymbol(target.dataset.symbol);
      if (action === 'scan') await this.runScan();
    },

    async runScan() {
      const instruments = this.app.instruments;
      this.scan = { running: true, rows: [], progress: 0 };
      this.renderScanner();
      for (const [index, instrument] of instruments.entries()) {
        this.scan.rows.push(await scanOne(this.app, instrument));
        this.scan.progress = ((index + 1) / instruments.length) * 100;
        this.renderScanner();
      }
      this.scan.running = false;
      this.renderScanner();
      APA.ui.toast(`Scanned ${instruments.length} markets.`);
    },
  };

  async function scanOne(app, instrument) {
    try {
      const { candleSets, timeframeSeconds } = await app.market.candleSet(instrument.symbol, app.settings.strategy);
      const simulation = APA.engine.run({ instrument, strategy: app.settings.strategy, candleSets, timeframeSeconds, costs: app.settings.backtest });
      const signal = APA.signal.describe(simulation);
      return { symbol: instrument.symbol, name: instrument.shortName, bias: signal.biasTrend, status: signal.status };
    } catch (error) {
      return { symbol: instrument.symbol, name: instrument.shortName, error: error.message };
    }
  }

  function planDraft(plan, app) {
    return {
      symbol: app.symbol, direction: plan.direction, entry: plan.entry, stop: plan.initialStop ?? plan.stop,
      target: plan.target, setup: app.analysis.signal.focus ? app.analysis.signal.focus.zone.model : '',
    };
  }

  function journalTable(entries, app, showResult) {
    return `<div class="table-wrap"><table><thead><tr><th>Opened</th><th>Market</th><th>Side</th><th class="num">Entry</th><th class="num">${showResult ? 'P&L' : 'Stop'}</th></tr></thead><tbody>
      ${entries.map((entry) => {
        const instrument = app.instruments.find((candidate) => candidate.symbol === entry.symbol) || app.instrument();
        return `<tr><td>${format.time(Math.floor(entry.openedAt / 1000))}</td><td>${escapeHtml(instrument.shortName)}</td>
          <td class="${entry.direction === 'buy' ? 'bull' : 'bear'}">${entry.direction === 'buy' ? 'Buy' : 'Sell'}</td>
          <td class="num">${format.price(instrument, entry.entry)}</td>
          <td class="num ${showResult ? toneOf(entry.pnl) : ''}">${showResult ? format.signedMoney(entry.pnl) : format.price(instrument, entry.stop)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  }

  APA.views = APA.views || {};
  APA.views.dashboard = view;
})((globalThis.APA = globalThis.APA || {}));
