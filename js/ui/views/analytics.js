(function (APA) {
  'use strict';

  const { $, escapeHtml, format, segmented } = APA.ui;
  const panels = APA.performancePanels;

  const SOURCES = [
    { value: 'journal', label: 'Journal (your trades)' },
    { value: 'backtest', label: 'Backtest (strategy replay)' },
  ];

  const view = {
    title: 'Analytics',
    subtitle: 'Win rate, profit factor, drawdown and where results come from',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.source = 'journal';
      this.equity = { chart: null };
      section.innerHTML = `
        <div class="panel panel-tight" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <div class="segmented" data-slot="source" role="radiogroup" aria-label="Results source"></div>
          <span class="source-label" data-slot="label"></span>
        </div>
        <div class="panel" data-slot="stats"></div>
        <div class="grid grid-2">
          <div class="panel"><div class="panel-head"><h2>${APA.icons.analytics}Equity curve</h2></div><div class="chart-box equity" data-slot="equity"></div></div>
          <div class="panel"><div class="panel-head"><div><h2>${APA.icons.clock}By trading session (UTC)</h2><p>The videos name no session; this is for review only.</p></div></div><div data-slot="sessions"></div></div>
        </div>
        <div class="grid grid-2">
          <div class="panel"><div class="panel-head"><h2>${APA.icons.layers}By setup type</h2></div><div data-slot="setups"></div></div>
          <div class="panel"><div class="panel-head"><h2>${APA.icons.target}By direction</h2></div><div data-slot="directions"></div></div>
        </div>`;
      segmented($('[data-slot="source"]', section), SOURCES, this.source, (value) => { this.source = value; this.render(); });
      for (const event of ['journal', 'backtest']) app.on(event, () => { if (!section.hidden) this.render(); });
    },

    show() { this.render(); },

    data() {
      if (this.source === 'journal') {
        const startingBalance = this.app.settings.risk.balance;
        return { results: this.app.journal.results(), startingBalance, label: 'Manually entered journal trades, stored in this browser.' };
      }
      const backtest = this.app.lastBacktest;
      if (!backtest) return { results: [], startingBalance: this.app.settings.backtest.startingBalance, label: 'No backtest run yet. Run one on the Backtest page.' };
      return { results: backtest.results, startingBalance: backtest.startingBalance, label: backtest.label };
    },

    render() {
      const { results, startingBalance, label } = this.data();
      const summary = APA.performance.summarize(results, startingBalance);
      $('[data-slot="label"]', this.section).innerHTML = `${this.source === 'journal' ? APA.icons.journal : APA.icons.backtest}${escapeHtml(label)}`;
      $('[data-slot="stats"]', this.section).innerHTML = `<div class="panel-head"><div><h2>${APA.icons.zap}Performance</h2>
        <p>${this.source === 'journal' ? 'Your real decisions' : 'Simulated by the strategy engine; not your trades'} · start ${format.money(startingBalance)}</p></div></div>${panels.statGrid(summary)}`;
      panels.drawEquity($('[data-slot="equity"]', this.section), this.equity, summary, startingBalance);
      $('[data-slot="sessions"]', this.section).innerHTML = panels.groupBars(APA.performance.groupBy(results, 'session', startingBalance));
      $('[data-slot="setups"]', this.section).innerHTML = panels.groupTable(APA.performance.groupBy(results, 'model', startingBalance));
      $('[data-slot="directions"]', this.section).innerHTML = panels.groupBars(APA.performance.groupBy(results, 'direction', startingBalance)
        .map((group) => ({ ...group, name: group.name === 'buy' ? 'Buys' : group.name === 'sell' ? 'Sells' : group.name })));
    },
  };

  APA.views = APA.views || {};
  APA.views.analytics = view;
})((globalThis.APA = globalThis.APA || {}));
