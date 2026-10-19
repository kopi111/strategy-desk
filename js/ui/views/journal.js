(function (APA) {
  'use strict';

  const { $, escapeHtml, format, toneOf, showFieldError, clearFieldErrors, numberFrom, emptyState } = APA.ui;

  const view = {
    title: 'Journal',
    subtitle: 'Every trade you take, saved in this browser',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.editingId = null;
      section.innerHTML = `
        <details class="panel collapse" data-slot="form-panel">
          <summary>Log a trade</summary>
          <form data-slot="form" novalidate style="margin-top:16px">
            <div class="form-grid">
              <label class="field"><span>Opened (local time)</span><input name="openedAt" type="datetime-local" required></label>
              <label class="field"><span>Instrument</span><select name="symbol"></select></label>
              <label class="field"><span>Direction</span><select name="direction"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
              <label class="field"><span>Strategy setup</span><select name="setup"></select></label>
              <label class="field"><span>Entry</span><input name="entry" type="number" step="any" required></label>
              <label class="field"><span>Stop loss</span><input name="stop" type="number" step="any"></label>
              <label class="field"><span>Take profit</span><input name="target" type="number" step="any"></label>
              <label class="field"><span>Lots</span><input name="lots" type="number" step="any" min="0"></label>
              <label class="field"><span>Exit price</span><input name="exit" type="number" step="any"><small>Leave empty while the trade is open</small></label>
              <label class="field"><span>Closed (local time)</span><input name="closedAt" type="datetime-local"></label>
              <label class="field"><span>Profit / loss (USD)</span><input name="pnl" type="number" step="any"><small>Worked out from lots and exit if left empty</small></label>
              <label class="field"><span>Followed the strategy?</span><select name="followed"><option value="yes">Yes</option><option value="no">No</option></select></label>
              <label class="field span-2"><span>Screenshot URL</span><input name="screenshot" type="url" placeholder="https://"></label>
              <label class="field span-2"><span>Notes</span><textarea name="notes"></textarea></label>
              <label class="field span-2"><span>Lessons learned</span><textarea name="lessons"></textarea></label>
            </div>
            <div class="form-actions" style="margin-top:16px">
              <button class="button" type="submit">${APA.icons.plus}<span data-slot="submit-label">Save trade</span></button>
              <button class="button button-ghost" type="button" data-action="cancel">Clear</button>
            </div>
          </form>
        </details>
        <div class="panel">
          <div class="panel-head"><div><h2>${APA.icons.journal}Trades</h2><p data-slot="count"></p></div></div>
          <form class="form-grid" data-slot="filters" style="margin-bottom:14px" aria-label="Filter trades">
            <label class="field"><span>Instrument</span><select name="symbol"><option value="">All</option></select></label>
            <label class="field"><span>Direction</span><select name="direction"><option value="">All</option><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
            <label class="field"><span>Outcome</span><select name="outcome"><option value="">All</option><option value="win">Win</option><option value="loss">Loss</option><option value="open">Open</option></select></label>
            <label class="field"><span>From</span><input name="from" type="date"></label>
            <label class="field"><span>To</span><input name="to" type="date"></label>
          </form>
          <div data-slot="table"></div>
        </div>`;
      this.form = $('[data-slot="form"]', section);
      this.filters = $('[data-slot="filters"]', section);
      this.form.elements.setup.innerHTML = APA.ui.modelOptions('', true);
      this.form.addEventListener('submit', (event) => { event.preventDefault(); this.save(); });
      this.filters.addEventListener('input', () => this.renderTable());
      section.addEventListener('click', (event) => this.handleClick(event));
      app.on('settings', () => this.fillInstrumentLists());
      this.fillInstrumentLists();
      this.clearForm();
    },

    show() {
      if (this.app.journalDraft) {
        this.loadDraft(this.app.journalDraft);
        this.app.journalDraft = null;
      }
      this.renderTable();
    },

    fillInstrumentLists() {
      this.form.elements.symbol.innerHTML = APA.ui.instrumentOptions(this.app.instruments, this.app.symbol);
      this.filters.elements.symbol.innerHTML = `<option value="">All</option>${APA.ui.instrumentOptions(this.app.instruments, '')}`;
    },

    clearForm() {
      this.form.reset();
      this.editingId = null;
      clearFieldErrors(this.form);
      this.form.elements.openedAt.value = localInput(Date.now());
      this.form.elements.symbol.value = this.app.symbol;
      $('[data-slot="submit-label"]', this.section).textContent = 'Save trade';
    },

    loadDraft(draft) {
      this.clearForm();
      const instrument = APA.instruments.bySymbol(this.app.instruments, draft.symbol);
      this.form.elements.symbol.value = draft.symbol;
      this.form.elements.direction.value = draft.direction;
      this.form.elements.setup.value = draft.setup || '';
      for (const name of ['entry', 'stop', 'target']) {
        if (Number.isFinite(draft[name])) this.form.elements[name].value = APA.instruments.formatPrice(instrument, draft[name]);
      }
      $('[data-slot="form-panel"]', this.section).open = true;
      this.form.elements.lots.focus();
    },

    save() {
      clearFieldErrors(this.form);
      const elements = this.form.elements;
      const openedAt = Date.parse(elements.openedAt.value);
      if (Number.isNaN(openedAt)) { showFieldError(this.form, 'openedAt', 'Enter when the trade was opened.'); return; }
      const entry = numberFrom(this.form, 'entry');
      if (!(entry > 0)) { showFieldError(this.form, 'entry', 'Entry price must be above 0.'); return; }
      const direction = elements.direction.value;
      const stop = numberFrom(this.form, 'stop');
      if (Number.isFinite(stop) && (direction === 'buy' ? stop >= entry : stop <= entry)) {
        showFieldError(this.form, 'stop', `For a ${direction}, the stop must be ${direction === 'buy' ? 'below' : 'above'} the entry.`);
        return;
      }
      const exit = numberFrom(this.form, 'exit');
      const lots = numberFrom(this.form, 'lots');
      const closedAt = elements.closedAt.value ? Date.parse(elements.closedAt.value) : (Number.isFinite(exit) ? Date.now() : null);
      if (closedAt !== null && closedAt < openedAt) { showFieldError(this.form, 'closedAt', 'The close time is before the open time.'); return; }
      const instrument = APA.instruments.bySymbol(this.app.instruments, elements.symbol.value);
      const draft = { direction, entry, stop: Number.isFinite(stop) ? stop : null, exit: Number.isFinite(exit) ? exit : null, lots: Number.isFinite(lots) ? lots : null };
      const outcome = APA.journalOutcome(draft, instrument);
      const typedPnl = numberFrom(this.form, 'pnl');
      const pnl = Number.isFinite(typedPnl) ? typedPnl : outcome.pnl;
      if (draft.exit !== null && !Number.isFinite(pnl)) { showFieldError(this.form, 'lots', 'Enter lots (or the profit / loss) so the result can be recorded.'); return; }

      try {
        this.app.journal.save({
          id: this.editingId, symbol: elements.symbol.value, setup: elements.setup.value, openedAt, closedAt,
          ...draft, target: numberFrom(this.form, 'target') || null, pnl: draft.exit !== null ? pnl : null, rMultiple: outcome.rMultiple,
          followed: elements.followed.value === 'yes', screenshot: elements.screenshot.value.trim(),
          notes: elements.notes.value.trim(), lessons: elements.lessons.value.trim(),
        });
      } catch (error) {
        APA.ui.toast(error.message, 'error');
        return;
      }
      APA.ui.toast(this.editingId ? 'Trade updated.' : 'Trade saved to the journal.');
      this.clearForm();
      this.renderTable();
      this.app.emit('journal');
    },

    filtered() {
      const values = Object.fromEntries(['symbol', 'direction', 'outcome', 'from', 'to'].map((name) => [name, this.filters.elements[name].value]));
      const from = values.from ? Date.parse(`${values.from}T00:00:00`) : -Infinity;
      const to = values.to ? Date.parse(`${values.to}T23:59:59`) : Infinity;
      return this.app.journal.all().filter((entry) => {
        if (values.symbol && entry.symbol !== values.symbol) return false;
        if (values.direction && entry.direction !== values.direction) return false;
        if (entry.openedAt < from || entry.openedAt > to) return false;
        const isOpen = entry.exit === null || entry.exit === undefined;
        if (values.outcome === 'open') return isOpen;
        if (values.outcome === 'win') return !isOpen && entry.pnl > 0;
        if (values.outcome === 'loss') return !isOpen && entry.pnl <= 0;
        return true;
      });
    },

    renderTable() {
      const entries = this.filtered();
      const total = this.app.journal.all().length;
      $('[data-slot="count"]', this.section).textContent = `${entries.length} of ${total} trade${total === 1 ? '' : 's'} · stored only in this browser`;
      const slot = $('[data-slot="table"]', this.section);
      if (!total) { slot.innerHTML = emptyState('Your journal is empty', 'Log your first trade above, or use "Log in journal" on the dashboard signal.', 'journal'); return; }
      if (!entries.length) { slot.innerHTML = emptyState('No trades match', 'Change or clear the filters to see more trades.', 'journal'); return; }
      slot.innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Opened</th><th>Market</th><th>Side</th><th>Setup</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Target</th><th class="num">Exit</th><th class="num">P&L</th><th class="num">R</th><th>Rules</th><th>Notes</th><th></th></tr></thead><tbody>
        ${entries.map((entry) => this.rowHtml(entry)).join('')}</tbody></table></div>`;
    },

    rowHtml(entry) {
      const instrument = this.app.instruments.find((candidate) => candidate.symbol === entry.symbol) || this.app.instrument();
      const isOpen = entry.exit === null || entry.exit === undefined;
      const note = [entry.notes, entry.lessons && `Lesson: ${entry.lessons}`].filter(Boolean).join(' · ');
      return `<tr>
        <td>${format.time(Math.floor(entry.openedAt / 1000))}</td><td>${escapeHtml(instrument.shortName)}</td>
        <td class="${entry.direction === 'buy' ? 'bull' : 'bear'}">${entry.direction === 'buy' ? 'Buy' : 'Sell'}</td>
        <td>${entry.setup ? escapeHtml(APA.zones.model(entry.setup).name) : '<span class="muted">—</span>'}</td>
        <td class="num">${format.price(instrument, entry.entry)}</td><td class="num">${format.price(instrument, entry.stop)}</td>
        <td class="num">${format.price(instrument, entry.target)}</td>
        <td class="num">${isOpen ? '<span class="tag tag-accent">OPEN</span>' : format.price(instrument, entry.exit)}</td>
        <td class="num ${toneOf(entry.pnl)}">${isOpen ? '—' : format.signedMoney(entry.pnl)}</td>
        <td class="num ${toneOf(entry.rMultiple)}">${format.r(entry.rMultiple)}</td>
        <td>${entry.followed ? '<span class="tag tag-bull">Followed</span>' : '<span class="tag tag-bear">Broke rules</span>'}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(note)}">${entry.screenshot ? `<a href="${escapeHtml(entry.screenshot)}" target="_blank" rel="noopener noreferrer">Screenshot</a> ` : ''}${escapeHtml(note) || '<span class="muted">—</span>'}</td>
        <td><div class="row-actions"><button class="icon-button" style="width:30px;height:30px" data-action="edit" data-id="${entry.id}" aria-label="Edit trade">${APA.icons.edit}</button>
          <button class="icon-button" style="width:30px;height:30px" data-action="delete" data-id="${entry.id}" aria-label="Delete trade">${APA.icons.trash}</button></div></td></tr>`;
    },

    handleClick(event) {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'cancel') this.clearForm();
      if (target.dataset.action === 'edit') this.edit(target.dataset.id);
      if (target.dataset.action === 'delete') this.confirmDelete(target);
    },

    // Two-step delete without a browser dialog: the first click arms the button, the second deletes.
    confirmDelete(button) {
      if (button.dataset.armed !== 'true') {
        button.dataset.armed = 'true';
        button.classList.add('button-danger');
        button.setAttribute('aria-label', 'Click again to delete');
        button.title = 'Click again to delete';
        setTimeout(() => { button.dataset.armed = 'false'; button.classList.remove('button-danger'); }, 3000);
        return;
      }
      this.app.journal.remove(button.dataset.id);
      APA.ui.toast('Trade deleted.');
      this.renderTable();
      this.app.emit('journal');
    },

    edit(id) {
      const entry = this.app.journal.all().find((candidate) => candidate.id === id);
      if (!entry) return;
      this.clearForm();
      this.editingId = id;
      const elements = this.form.elements;
      elements.openedAt.value = localInput(entry.openedAt);
      elements.closedAt.value = entry.closedAt ? localInput(entry.closedAt) : '';
      for (const name of ['symbol', 'direction', 'setup']) elements[name].value = entry[name] || '';
      for (const name of ['entry', 'stop', 'target', 'lots', 'exit', 'pnl']) elements[name].value = Number.isFinite(entry[name]) ? entry[name] : '';
      elements.followed.value = entry.followed ? 'yes' : 'no';
      for (const name of ['screenshot', 'notes', 'lessons']) elements[name].value = entry[name] || '';
      $('[data-slot="submit-label"]', this.section).textContent = 'Update trade';
      $('[data-slot="form-panel"]', this.section).open = true;
      elements.entry.focus();
    },
  };

  function localInput(milliseconds) {
    const date = new Date(milliseconds);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  APA.views = APA.views || {};
  APA.views.journal = view;
})((globalThis.APA = globalThis.APA || {}));
