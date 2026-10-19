(function (APA) {
  'use strict';

  const { $, escapeHtml, format, segmented, segmentedValue, showFieldError, clearFieldErrors, numberFrom } = APA.ui;

  const view = {
    title: 'Position size',
    subtitle: 'Cash risk, lot size and reward-to-risk for any setup',

    mount(section, app) {
      this.section = section;
      this.app = app;
      section.innerHTML = `
        <div class="grid grid-sidebar">
          <form class="panel" data-slot="form" novalidate>
            <div class="panel-head"><div><h2>${APA.icons.calculator}Trade setup</h2><p>Results update as you type. Lots round down so risk never exceeds your %.</p></div>
              <button type="button" class="button button-ghost button-small" data-action="from-signal">${APA.icons.zap}Use current signal</button></div>
            <div class="form-grid">
              <label class="field span-2"><span>Instrument</span><select name="symbol"></select></label>
              <div class="field"><span class="field-label">Direction</span><div class="segmented direction" data-slot="direction" role="radiogroup" aria-label="Direction"></div></div>
              <label class="field"><span>Account balance (USD)</span><input name="balance" type="number" min="0" step="any" inputmode="decimal"></label>
              <label class="field"><span>Risk per trade (%)</span><input name="riskPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal"></label>
              <label class="field"><span>Entry price</span><input name="entry" type="number" step="any" inputmode="decimal"></label>
              <label class="field"><span>Stop-loss price</span><input name="stop" type="number" step="any" inputmode="decimal"></label>
              <label class="field"><span>Take-profit price</span><input name="target" type="number" step="any" inputmode="decimal"><small>Optional</small></label>
              <label class="field"><span>Contract size</span><input name="contractSize" type="number" min="0" step="any"><small>Units per 1.00 lot</small></label>
              <label class="field"><span>Pip size</span><input name="pipSize" type="number" min="0" step="any"><small>Price move of one pip</small></label>
            </div>
            <div class="divider" style="margin:18px 0"></div>
            <div class="note" data-slot="instrument-note"></div>
          </form>
          <div class="grid" style="align-content:start">
            <div class="panel" data-slot="results"></div>
            <div class="panel"><div class="panel-head"><h3>${APA.icons.shield}What the videos say</h3></div>
              <div class="explain"><p>Risk 1–2% per trade (V1 16:42). Take at least 1:3 (V1 19:20); close half at 1:3 and move the stop to break-even (V1 37:00). Stops sit a few pips beyond the key level (V1 5:16).</p></div></div>
          </div>
        </div>`;
      this.form = $('[data-slot="form"]', section);
      this.form.addEventListener('input', (event) => { if (event.target.name === 'symbol') this.applyInstrument(); this.calculate(); });
      this.form.addEventListener('submit', (event) => event.preventDefault());
      section.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="from-signal"]')) this.fillFromSignal();
      });
      this.resetForm();
      app.on('settings', () => this.resetForm());
    },

    show() {
      if (this.app.calculatorDraft) {
        this.fill(this.app.calculatorDraft);
        this.app.calculatorDraft = null;
      }
      this.calculate();
    },

    resetForm() {
      const { settings, symbol } = this.app;
      this.form.elements.symbol.innerHTML = APA.ui.instrumentOptions(this.app.instruments, symbol);
      this.form.elements.balance.value = settings.risk.balance;
      this.form.elements.riskPercent.value = settings.risk.riskPercent;
      segmented($('[data-slot="direction"]', this.section), [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }], 'buy', () => this.calculate());
      this.applyInstrument();
      this.calculate();
    },

    applyInstrument() {
      const instrument = this.selectedInstrument();
      this.form.elements.contractSize.value = instrument.contractSize;
      this.form.elements.pipSize.value = instrument.pipSize;
      $('[data-slot="instrument-note"]', this.section).innerHTML = `<strong>${escapeHtml(instrument.name)}</strong>: min lot ${instrument.minLot}, step ${instrument.lotStep}. ${
        instrument.pnlConversion === 'usd-base' ? 'Profit is earned in the quote currency and converted to USD at the trade price.' : 'Profit is in USD.'
      } Specs differ by broker; edit them in Settings → Instruments.`;
    },

    selectedInstrument() {
      const base = APA.instruments.bySymbol(this.app.instruments, this.form.elements.symbol.value || this.app.symbol);
      const contractSize = numberFrom(this.form, 'contractSize');
      const pipSize = numberFrom(this.form, 'pipSize');
      return { ...base, contractSize: contractSize > 0 ? contractSize : base.contractSize, pipSize: pipSize > 0 ? pipSize : base.pipSize };
    },

    fillFromSignal() {
      const signal = this.app.analysis && this.app.analysis.signal;
      if (!signal || !signal.plan || signal.plan.ok === false) {
        APA.ui.toast('There is no valid signal plan to copy right now.', 'error');
        return;
      }
      this.fill({ symbol: this.app.symbol, direction: signal.plan.direction, entry: signal.plan.entry, stop: signal.plan.initialStop ?? signal.plan.stop, target: signal.plan.target });
      APA.ui.toast('Copied entry, stop and target from the current signal.');
    },

    fill(draft) {
      const instrument = APA.instruments.bySymbol(this.app.instruments, draft.symbol);
      this.form.elements.symbol.value = draft.symbol;
      this.applyInstrument();
      segmented($('[data-slot="direction"]', this.section), [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }], draft.direction, () => this.calculate());
      this.form.elements.entry.value = APA.instruments.formatPrice(instrument, draft.entry);
      this.form.elements.stop.value = APA.instruments.formatPrice(instrument, draft.stop);
      this.form.elements.target.value = Number.isFinite(draft.target) ? APA.instruments.formatPrice(instrument, draft.target) : '';
      this.calculate();
    },

    calculate() {
      const slot = $('[data-slot="results"]', this.section);
      clearFieldErrors(this.form);
      const filled = ['entry', 'stop'].every((name) => String(this.form.elements[name].value).trim() !== '');
      if (!filled) {
        slot.innerHTML = `<div class="panel-head"><h2>${APA.icons.target}Results</h2></div>${APA.ui.emptyState('Enter entry and stop', 'Add an entry price and a stop-loss price to size the position.', 'calculator')}`;
        return;
      }
      const instrument = this.selectedInstrument();
      try {
        const result = APA.positionSize.calculate({
          instrument, direction: segmentedValue($('[data-slot="direction"]', this.section)),
          balance: numberFrom(this.form, 'balance'), riskPercent: numberFrom(this.form, 'riskPercent'),
          entry: numberFrom(this.form, 'entry'), stop: numberFrom(this.form, 'stop'), target: numberFrom(this.form, 'target'),
        });
        slot.innerHTML = this.resultsHtml(result, instrument);
      } catch (error) {
        if (!(error instanceof APA.positionSize.InputError)) throw error;
        showFieldError(this.form, error.field, error.message);
        slot.innerHTML = `<div class="panel-head"><h2>${APA.icons.target}Results</h2></div><div class="note"><strong>Check the form:</strong> ${escapeHtml(error.message)}</div>`;
      }
    },

    resultsHtml(result, instrument) {
      const minRR = this.app.settings.strategy.minRewardToRisk;
      const maxRisk = this.app.settings.risk.maxRiskPercent;
      const rrOk = result.rewardToRisk === null || result.rewardToRisk >= minRR;
      const stats = [
        ['Position size', `${result.lots} lots`],
        ['Cash risk', format.money(result.cashRisk)],
        ['Stop distance', `${format.price(instrument, result.stopDistance)} · ${format.number(result.stopPips, 1)} pips`],
        ['Potential loss', format.money(-result.potentialLoss)],
        ['Potential profit', result.potentialProfit === null ? '—' : format.money(result.potentialProfit)],
        ['Reward : risk', result.rewardToRisk === null ? '—' : format.ratio(result.rewardToRisk)],
      ];
      return `
        <div class="panel-head"><h2>${APA.icons.target}Results</h2>${result.rewardToRisk === null ? '' : `<span class="tag ${rrOk ? 'tag-bull' : 'tag-bear'}">${rrOk ? `Meets 1:${minRR}` : `Below 1:${minRR}`}</span>`}</div>
        <div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">${stats.map(([label, value]) => `<div class="stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
        <div class="note" style="margin-top:12px">Real risk after rounding: <strong>${result.actualRiskPercent.toFixed(2)}%</strong> of the account.
          ${result.actualRiskPercent > maxRisk ? `<span class="bear"> Above your ${maxRisk}% cap.</span>` : ''}
          ${!rrOk ? `<br><span class="bear">The strategy skips trades under 1:${minRR}.</span>` : ''}</div>`;
    },
  };

  APA.views = APA.views || {};
  APA.views.calculator = view;
})((globalThis.APA = globalThis.APA || {}));
