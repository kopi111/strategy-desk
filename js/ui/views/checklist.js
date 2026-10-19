(function (APA) {
  'use strict';

  const { $, $$, escapeHtml } = APA.ui;
  const guide = APA.strategyGuide;

  // Which manual checks the engine can vouch for, keyed by the engine checklist row that proves them.
  const ENGINE_ROW_FOR_CHECK = { htf: 0, bodies: 1, trend: 2, liquidity: 3, tap: 4, confirm: 5, reward: 6 };

  const view = {
    title: 'Checklist',
    subtitle: 'Tick every rule before you take a trade',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.modelId = 'qmInvalidation';
      this.ticked = new Set();
      section.innerHTML = `
        <div class="grid grid-sidebar">
          <div class="panel">
            <div class="panel-head">
              <div><h2>${APA.icons.checklist}Trade confirmation checklist</h2><p>Mandatory items must all be ticked before the setup counts as valid.</p></div>
              <div class="form-actions">
                <label class="field" style="min-width:230px"><span class="field-label">Entry model</span><select data-slot="model" aria-label="Entry model">${APA.ui.modelOptions(this.modelId)}</select></label>
              </div>
            </div>
            <ul class="manual-list" data-slot="items"></ul>
            <div class="form-actions" style="margin-top:16px">
              <button class="button button-ghost" data-action="engine">${APA.icons.zap}Tick what the engine verified</button>
              <button class="button button-ghost" data-action="reset">Reset</button>
            </div>
          </div>
          <div class="grid" style="align-content:start">
            <div class="panel" data-slot="status"></div>
            <div class="panel" data-slot="model-info"></div>
          </div>
        </div>`;
      $('[data-slot="model"]', section).addEventListener('change', (event) => { this.modelId = event.target.value; this.ticked.clear(); this.render(); });
      section.addEventListener('change', (event) => {
        if (!event.target.matches('input[data-check]')) return;
        if (event.target.checked) this.ticked.add(event.target.dataset.check); else this.ticked.delete(event.target.dataset.check);
        this.renderStatus();
        event.target.closest('li').classList.toggle('is-checked', event.target.checked);
      });
      section.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'reset') { this.ticked.clear(); this.render(); APA.ui.toast('Checklist cleared.'); }
        if (action.dataset.action === 'engine') this.tickFromEngine();
      });
      this.render();
    },

    show() { this.render(); },

    items() { return guide.checklistFor(this.modelId); },

    render() {
      $('[data-slot="model"]', this.section).value = this.modelId;
      $('[data-slot="items"]', this.section).innerHTML = this.items().map((item) => `
        <li class="${this.ticked.has(item.id) ? 'is-checked' : ''}">
          <label class="check"><input type="checkbox" data-check="${item.id}" ${this.ticked.has(item.id) ? 'checked' : ''}>
            <span><strong>${escapeHtml(item.text)}</strong>${item.mandatory ? '<span class="badge-mandatory">Required</span>' : '<span class="badge-optional">Optional</span>'}
              <small><a class="source" href="${guide.link(item.source[0], item.source[1])}" target="_blank" rel="noopener">${item.source[0]} ${item.source[1]}</a></small></span></label>
        </li>`).join('');
      this.renderStatus();
      this.renderModelInfo();
    },

    renderStatus() {
      const items = this.items();
      const missing = items.filter((item) => item.mandatory && !this.ticked.has(item.id));
      const valid = missing.length === 0;
      $('[data-slot="status"]', this.section).innerHTML = `
        <div class="panel-head"><h2>${APA.icons.shield}Setup status</h2><span class="tag ${valid ? 'tag-bull' : 'tag-wait'}">${valid ? 'VALID' : 'NOT VALID'}</span></div>
        <div class="setup-state ${valid ? 'setup-valid' : 'setup-invalid'}" style="margin-top:0">${valid ? APA.icons.check : APA.icons.clock}
          ${valid ? 'Every required rule is ticked. The setup matches the strategy.' : `${missing.length} required rule${missing.length === 1 ? '' : 's'} still open.`}</div>
        ${missing.length ? `<div class="explain" style="margin-top:12px"><p class="muted">Still missing:</p><ul class="checklist">${missing.map((item) => `
          <li><span class="mark mark-pending">${APA.icons.clock}</span><div><strong>${escapeHtml(item.text)}</strong></div></li>`).join('')}</ul></div>` : ''}`;
    },

    renderModelInfo() {
      const model = APA.zones.model(this.modelId);
      const detail = guide.MODEL_GUIDE[this.modelId];
      $('[data-slot="model-info"]', this.section).innerHTML = `
        <div class="panel-head"><h3>${APA.icons.rules}${escapeHtml(model.name)}</h3><span class="tag">${detail.direction}</span></div>
        <div class="explain"><p>${escapeHtml(model.summary)}</p>
          <ol style="margin:0;padding-left:18px;color:var(--text-soft);display:flex;flex-direction:column;gap:4px">${detail.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
          <p>${detail.sources.map(([video, time]) => `<a class="ts" href="${guide.link(video, time)}" target="_blank" rel="noopener">${video} ${time}</a>`).join(' · ')}</p></div>`;
    },

    tickFromEngine() {
      const signal = this.app.analysis && this.app.analysis.signal;
      if (!signal || !signal.focus) { APA.ui.toast('The engine has no zone in focus to check against.', 'error'); return; }
      this.modelId = signal.focus.zone.model;
      this.ticked.clear();
      for (const item of this.items()) {
        const row = item.id.startsWith(`${this.modelId}-`) ? 1 : ENGINE_ROW_FOR_CHECK[item.id];
        const result = row === undefined ? null : signal.checklist[row] && signal.checklist[row].result;
        if (result === 'pass' || (result === 'n/a' && item.id !== 'liquidity')) this.ticked.add(item.id);
      }
      this.render();
      APA.ui.toast(`Ticked what the engine verified for ${APA.zones.model(this.modelId).name}. Stop, risk and daily checks are yours.`);
      $$('input[data-check]', this.section).find((input) => !input.checked)?.focus();
    },
  };

  APA.views = APA.views || {};
  APA.views.checklist = view;
})((globalThis.APA = globalThis.APA || {}));
