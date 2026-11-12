(function (APA) {
  'use strict';

  const { $, $$, escapeHtml, format, segmented, segmentedValue, showFieldError, clearFieldErrors, numberFrom } = APA.ui;
  const DIRECTIONS = [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }];
  const MARK = { pass: ['mark-pass', 'check'], warn: ['mark-pending', 'clock'], fix: ['mark-fail', 'cross'] };

  const view = {
    title: 'Mentor',
    subtitle: 'Check a trade plan, see what a losing run does, and learn the terms',

    // This function draws the page once and wires up its buttons and boxes.
    mount(section, app) {
      this.section = section;
      this.app = app;
      section.innerHTML = `
        <div class="grid grid-sidebar">
          <form class="panel" data-slot="plan" novalidate>
            <div class="panel-head"><div><h2>${APA.icons.checklist}Check my trade plan</h2><p>Write the plan before you place it. No plan passes without a stop-loss.</p></div>
              <button type="button" class="button button-ghost button-small" data-action="from-signal">${APA.icons.zap}Use current signal</button></div>
            <div class="form-grid">
              <label class="field span-2"><span>Market</span><select name="symbol"></select></label>
              <div class="field"><span class="field-label">Direction</span><div class="segmented direction" data-slot="direction" role="radiogroup" aria-label="Direction"></div></div>
              <label class="field"><span>Entry price</span><input name="entry" type="number" step="any" inputmode="decimal"></label>
              <label class="field"><span>Stop-loss price</span><input name="stop" type="number" step="any" inputmode="decimal"></label>
              <label class="field"><span>Take-profit price</span><input name="target" type="number" step="any" inputmode="decimal"></label>
              <label class="field"><span>Risk per trade (%)</span><input name="riskPercent" type="number" min="0" max="100" step="0.1" inputmode="decimal"></label>
              <label class="field span-2"><span>Why this trade?</span><textarea name="reason" placeholder="Setup and level, e.g. 15m sweep of the Asia low into the 1H RBS zone"></textarea></label>
            </div>
            <div class="form-actions" style="margin-top:16px">
              <button type="submit" class="button">${APA.icons.shield}Check plan</button>
              <button type="button" class="button button-ghost" data-action="size" hidden>${APA.icons.calculator}Size it</button>
            </div>
          </form>
          <div class="grid" style="align-content:start">
            <div class="panel" data-slot="verdict"></div>
            <div class="panel" data-slot="streak"></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><h2>${APA.icons.rules}Learn the terms</h2><p>The short version first. Open a card for the detail and what this Desk found when it tested the idea.</p></div></div>
          <div class="model-grid mentor-lessons" data-slot="lessons"></div>
        </div>`;
      this.form = $('[data-slot="plan"]', section);
      this.form.addEventListener('submit', (event) => { event.preventDefault(); this.checkPlan(); });
      this.form.addEventListener('input', (event) => { if (event.target.name === 'riskPercent') this.renderStreak(); });
      section.addEventListener('click', (event) => this.handleClick(event));
      this.resetForm();
      this.renderLessons();
      app.on('settings', () => this.resetForm());
    },

    // This function refreshes the parts that depend on Settings each time the page opens.
    show() {
      this.renderStreak();
    },

    // This function sends each button click to the action it belongs to.
    handleClick(event) {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'from-signal') this.fillFromSignal();
      if (action.dataset.action === 'size') this.app.openCalculatorWith(this.readPlan());
      if (action.dataset.action === 'open-view') this.app.navigate(action.dataset.view);
    },

    // This function puts the form back to the selected market and the risk % from Settings.
    resetForm() {
      this.form.elements.symbol.innerHTML = APA.ui.instrumentOptions(this.app.instruments, this.app.symbol);
      this.form.elements.riskPercent.value = this.app.settings.risk.riskPercent;
      segmented($('[data-slot="direction"]', this.section), DIRECTIONS, 'buy', () => {});
      this.renderVerdictEmpty();
      this.renderStreak();
    },

    // This function copies entry, stop and take-profit from the engine's current signal into the form.
    fillFromSignal() {
      const signal = this.app.analysis && this.app.analysis.signal;
      if (!signal || !signal.plan || signal.plan.ok === false) {
        APA.ui.toast('There is no valid signal plan to copy right now.', 'error');
        return;
      }
      const plan = signal.plan;
      const instrument = this.app.instrument();
      this.form.elements.symbol.value = this.app.symbol;
      segmented($('[data-slot="direction"]', this.section), DIRECTIONS, plan.direction, () => {});
      this.form.elements.entry.value = APA.instruments.formatPrice(instrument, plan.entry);
      this.form.elements.stop.value = APA.instruments.formatPrice(instrument, plan.initialStop ?? plan.stop);
      this.form.elements.target.value = Number.isFinite(plan.target) ? APA.instruments.formatPrice(instrument, plan.target) : '';
      APA.ui.toast('Copied the current signal. Add your reason, then check the plan.');
    },

    // This function reads the form into a plain plan object.
    readPlan() {
      return {
        symbol: this.form.elements.symbol.value,
        direction: segmentedValue($('[data-slot="direction"]', this.section)),
        entry: numberFrom(this.form, 'entry'),
        stop: numberFrom(this.form, 'stop'),
        target: numberFrom(this.form, 'target'),
        riskPercent: numberFrom(this.form, 'riskPercent'),
        reason: this.form.elements.reason.value,
      };
    },

    // This function checks the plan, shows the result and points at the first box that needs fixing.
    checkPlan() {
      clearFieldErrors(this.form);
      const limits = { minRewardToRisk: this.app.settings.strategy.minRewardToRisk, maxRiskPercent: this.app.settings.risk.maxRiskPercent };
      const result = APA.tradePlanCheck.review(this.readPlan(), limits);
      this.renderVerdict(result);
      $('[data-action="size"]', this.section).hidden = !result.ready;
      if (!result.ready) showFieldError(this.form, result.toFix[0].field, result.toFix[0].text);
    },

    // This function shows the empty result box before any plan is checked.
    renderVerdictEmpty() {
      $('[data-slot="verdict"]', this.section).innerHTML = `<div class="panel-head"><h2>${APA.icons.shield}Plan check</h2></div>
        ${APA.ui.emptyState('No plan checked yet', 'Fill in the plan and press Check plan.', 'checklist')}`;
    },

    // This function shows each rule's result and whether the plan is ready.
    renderVerdict(result) {
      const tag = result.ready ? '<span class="tag tag-bull">READY</span>' : '<span class="tag tag-bear">FIX FIRST</span>';
      const lines = result.checks.map((check) => {
        const [markClass, icon] = MARK[check.status];
        return `<li data-status="${check.status}"><span class="mark ${markClass}">${APA.icons[icon]}</span><div><strong>${escapeHtml(check.text)}</strong></div></li>`;
      }).join('');
      $('[data-slot="verdict"]', this.section).innerHTML = `
        <div class="panel-head"><h2>${APA.icons.shield}Plan check</h2>${tag}</div>
        <ul class="checklist">${lines}</ul>
        <div class="note" style="margin-top:12px">${result.ready
          ? 'The plan follows the risk rules. That does not make it a winner: no rule tested on this Desk beat the spread except the slow gold trend.'
          : `${result.toFix.length} thing${result.toFix.length === 1 ? '' : 's'} to fix before this plan is ready.`}</div>`;
    },

    // This function shows what a run of losses does to the account at the risk % in the form.
    renderStreak() {
      const slot = $('[data-slot="streak"]', this.section);
      const riskPercent = numberFrom(this.form, 'riskPercent');
      const head = `<div class="panel-head"><h3>${APA.icons.target}If you lose in a row</h3></div>`;
      let rows;
      try {
        rows = APA.riskStreak.table(riskPercent);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        slot.innerHTML = `${head}<div class="note">Set a risk % above 0 to see what a losing run does.</div>`;
        return;
      }
      const minRR = this.app.settings.strategy.minRewardToRisk;
      slot.innerHTML = `${head}
        <div class="table-wrap"><table class="mentor-streak"><thead><tr><th>Losses</th><th class="num">Left</th><th class="num">To get back</th></tr></thead><tbody>
          ${rows.map((row) => `<tr><td>${row.losses}</td><td class="num">${format.percent(row.shareLeft)}</td><td class="num">${format.percent(row.gainNeeded)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="note" style="margin-top:12px">At ${riskPercent}% a trade. At your 1:${minRR} minimum you need to win ${format.percent(APA.riskStreak.breakEvenWinRate(minRR))} of trades to break even, before costs.</div>`;
    },

    // This function draws the lesson cards, with the detail folded away until opened.
    renderLessons() {
      $('[data-slot="lessons"]', this.section).innerHTML = APA.mentorGuide.LESSONS.map((lesson) => `
        <article class="panel mentor-lesson" data-lesson="${lesson.id}">
          <h3>${escapeHtml(lesson.title)}</h3>
          <p>${escapeHtml(lesson.simple)}</p>
          <details><summary>More detail</summary>
            <ul>${lesson.depth.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
            <p class="mentor-desk"><strong>On this Desk:</strong> ${escapeHtml(lesson.desk)}</p>
            ${lesson.link ? `<button type="button" class="button button-ghost button-small" data-action="open-view" data-view="${lesson.link.view}">Open ${escapeHtml(lesson.link.label)}</button>` : ''}
          </details>
        </article>`).join('');
    },
  };

  APA.views = APA.views || {};
  APA.views.mentor = view;
})((globalThis.APA = globalThis.APA || {}));
