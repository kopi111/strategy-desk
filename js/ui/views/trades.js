(function (APA) {
  'use strict';

  const { $, escapeHtml, format, emptyState, toast } = APA.ui;
  const STALE_AFTER_MS = 5 * 60 * 1000;
  const STATUS_ORDER = { ready: 0, waiting: 1, none: 2, failed: 3 };
  const STATUS_LABEL = { ready: 'Now', waiting: 'On a pullback' };

  const view = {
    title: 'Trades',
    subtitle: 'Potential buys and sells on every market, each shown with its backtest result',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.plans = new Map();
      this.goldRule = null;
      this.scannedAt = 0;
      this.isScanning = false;
      section.innerHTML = `
        <div class="grid" style="align-content:start">
          <div class="panel" data-slot="gold-rule"></div>
          <div class="panel" data-slot="market-plans"></div>
        </div>`;
      section.addEventListener('click', (event) => this.handleClick(event));
      // The page may open before Deriv has connected, so the first scan can start from here.
      app.on('source', () => { if (!section.hidden) this.show(); });
    },

    show() {
      this.render();
      if (this.isLive() && Date.now() - this.scannedAt > STALE_AFTER_MS) this.scan();
    },

    /** Demo candles must never suggest a trade. */
    isLive() {
      return this.app.market.status.kind === 'live';
    },

    /** Checks every market in turn, and shows each answer as it arrives. One market failing does not stop the others. */
    async scan() {
      if (this.isScanning) return;
      this.isScanning = true;
      this.render();
      try {
        await this.scanGoldRule();
        for (const instrument of this.app.instruments) {
          this.plans.set(instrument.symbol, await this.planFor(instrument.symbol));
          this.renderPlans();
        }
        this.scannedAt = Date.now();
      } finally {
        this.isScanning = false;
        this.renderPlans();
      }
    },

    /** Gets one market's plan. A failed check is shown as failed, so it can never look like "no trade". */
    async planFor(symbol) {
      try {
        return await APA.potentialTrade.forMarket(this.app.market, symbol);
      } catch (error) {
        console.warn(`[trades] could not check ${symbol}`, error);
        return { status: 'failed', side: 'none', reason: 'Could not check: Deriv did not answer.' };
      }
    },

    async scanGoldRule() {
      try {
        this.goldRule = await APA.potentialTrade.goldTrend(this.app.market);
      } catch (error) {
        console.warn('[trades] could not check the gold trend rule', error);
        this.goldRule = { status: 'failed', side: 'none', reason: 'Could not check: Deriv did not answer.' };
      }
      this.renderGoldRule();
    },

    render() {
      this.renderGoldRule();
      this.renderPlans();
    },

    /** Words for where the gold trend rule stands now. */
    goldRuleLine(rule, price) {
      if (rule.status === 'stopped') return `Its ${rule.side} from ${format.time(rule.since)} hit the stop. Wait for the next cross.`;
      return `${rule.side.toUpperCase()} since ${format.time(rule.since)}, entered ${price(rule.entry)}, stop ${price(rule.stop)}. No fixed TP: close when the averages cross back.`;
    },

    /** The one rule that has held up, kept apart from the setups that have not. */
    renderGoldRule() {
      const slot = $('[data-slot="gold-rule"]', this.section);
      const rule = this.goldRule;
      const gold = this.app.instrument('frxXAUUSD');
      const price = (value) => format.price(gold, value);
      const tag = rule && rule.side !== 'none' ? `<span class="tag tag-${rule.side === 'buy' ? 'bull' : 'bear'}" data-slot="gold-side">${rule.side.toUpperCase()}</span>` : '';
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.zap}Gold trend rule</h2><p>45-minute candles, EMA 20 and 100, stop 2 average ranges</p></div>${tag}</div>
        <p>${!rule ? 'Checking…' : rule.side === 'none' ? escapeHtml(rule.reason) : escapeHtml(this.goldRuleLine(rule, price))}</p>
        <p class="muted trades-note">Backtest: the only rule that held up. About +5% a year on gold 2023–2026 at 0.5% risk, worst drop 12%, before swap. It wins under half its trades, and swap could cut it to about +1–2% a year on Deriv.</p>`;
    },

    /** One table of plans, trades first. Markets with no trade follow, with the reason. */
    renderPlans() {
      const slot = $('[data-slot="market-plans"]', this.section);
      const checked = this.app.instruments.filter((instrument) => this.plans.has(instrument.symbol));
      const sorted = [...checked].sort((first, second) => STATUS_ORDER[this.plans.get(first.symbol).status] - STATUS_ORDER[this.plans.get(second.symbol).status]);
      const progress = this.isScanning ? `Checking ${checked.length} of ${this.app.instruments.length}…` : this.scannedAt ? `Last checked ${format.time(Math.floor(this.scannedAt / 1000))}` : 'Not checked yet';
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.radar}Chart setups</h2><p data-slot="scan-progress">${progress}</p></div>
          <button class="button button-ghost button-small" type="button" data-action="rescan" ${this.isScanning || !this.isLive() ? 'disabled' : ''}>Check again</button></div>
        ${!this.isLive() ? emptyState('Live prices only', 'Potential trades only run on live Deriv prices. Check the data source.') : ''}
        ${sorted.length ? `<div class="table-wrap"><table data-slot="plan-table"><thead><tr><th>Market</th><th>Side</th><th>When</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">TP</th><th class="num">Reward</th><th>Backtest</th></tr></thead>
          <tbody>${sorted.map((instrument) => this.planRow(instrument)).join('')}</tbody></table></div>` : ''}
        <p class="muted trades-note">A setup means the 1H and 4H trends agree, price is at or near a 15-minute order block or FVG, and a sweep or MSS happened in the last 4 hours. The stop sits half an average candle past the zone, and the TP is the last 24 hours' high or low. Backtested on about a year of Vix and 3.75 years of gold, this rule lost money after spread on all 11 markets tested.</p>`;
    },

    /** One market's row. Clicking the market opens its chart, where the lines are drawn. */
    planRow(instrument) {
      const plan = this.plans.get(instrument.symbol);
      const name = `<button type="button" class="trade-open" data-action="open-market" data-symbol="${escapeHtml(instrument.symbol)}">${escapeHtml(instrument.shortName)}</button>`;
      if (plan.status === 'none' || plan.status === 'failed') return `<tr><td>${name}</td><td colspan="7" class="trades-reason">${escapeHtml(plan.reason)}</td></tr>`;
      const price = (value) => format.price(instrument, value);
      const proof = APA.potentialTradeBacktest.describe(instrument.symbol);
      return `<tr data-side="${plan.side}"><td>${name}</td><td><span class="tag tag-${plan.side === 'buy' ? 'bull' : 'bear'}">${plan.side.toUpperCase()}</span></td><td>${STATUS_LABEL[plan.status]}</td>
        <td class="num">${price(plan.entry)}</td><td class="num">${price(plan.stop)}</td><td class="num">${price(plan.target)}</td><td class="num">${plan.rewardToRisk.toFixed(1)}R</td>
        <td class="${proof.tone}">${escapeHtml(proof.text)}</td></tr>`;
    },

    /** Opens the market on the 15-minute chart, where its lines are drawn. */
    async openMarket(symbol) {
      this.app.settings.selected.chartTimeframe = '15m';
      APA.settings.save(this.app.settings);
      await this.app.setSymbol(symbol);
      this.app.navigate('chart');
    },

    handleClick(event) {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'rescan') this.scan().catch((error) => { console.warn('[trades] scan failed', error); toast('Could not finish checking the markets.', 'error'); });
      if (target.dataset.action === 'open-market') this.openMarket(target.dataset.symbol);
    },
  };

  APA.views = APA.views || {};
  APA.views.trades = view;
})((globalThis.APA = globalThis.APA || {}));
