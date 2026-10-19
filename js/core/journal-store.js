(function (APA) {
  'use strict';

  const STORAGE_KEY = 'strategy-desk.journal.v1';

  /** Trade journal kept in this browser's localStorage. */
  class JournalStore {
    constructor() {
      this.entries = APA.storage.readJson(STORAGE_KEY) || [];
    }

    all() {
      return this.entries.slice().sort((first, second) => second.openedAt - first.openedAt);
    }

    save(entry) {
      const stored = { ...entry, id: entry.id || `trade-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
      const index = this.entries.findIndex((existing) => existing.id === stored.id);
      if (index >= 0) this.entries[index] = stored; else this.entries.push(stored);
      if (!this.persist()) throw new Error('This browser blocked saving. The trade is kept only until you close the page.');
      return stored;
    }

    remove(id) {
      this.entries = this.entries.filter((entry) => entry.id !== id);
      this.persist();
    }

    persist() {
      return APA.storage.writeJson(STORAGE_KEY, this.entries);
    }

    closed() {
      return this.entries.filter((entry) => Number.isFinite(entry.pnl) && entry.exit !== null && entry.exit !== undefined && entry.exit !== '');
    }

    open() {
      return this.entries.filter((entry) => entry.exit === null || entry.exit === undefined || entry.exit === '');
    }

    /** Journal trades in the shape APA.performance.summarize expects. */
    results() {
      return this.closed().map((entry) => ({
        time: Math.floor((entry.closedAt || entry.openedAt) / 1000),
        pnl: entry.pnl,
        r: Number.isFinite(entry.rMultiple) ? entry.rMultiple : undefined,
        model: entry.setup ? APA.zones.model(entry.setup).name : 'Unlabelled',
        session: APA.sessions.label(Math.floor(entry.openedAt / 1000)),
        direction: entry.direction,
        instrument: entry.symbol,
      }));
    }
  }

  /** Profit in USD and R multiple for a journal entry, from prices and lots. */
  function journalOutcome(entry, instrument) {
    if (!Number.isFinite(entry.exit) || !Number.isFinite(entry.lots) || entry.lots <= 0) return { pnl: null, rMultiple: null };
    const sign = entry.direction === 'buy' ? 1 : -1;
    const move = (entry.exit - entry.entry) * sign;
    const pnl = move * entry.lots * instrument.contractSize * APA.instruments.usdPerPriceUnit(instrument, entry.exit);
    const risk = Number.isFinite(entry.stop) ? Math.abs(entry.entry - entry.stop) : null;
    return { pnl, rMultiple: risk ? move / risk : null };
  }

  APA.JournalStore = JournalStore;
  APA.journalOutcome = journalOutcome;
})((globalThis.APA = globalThis.APA || {}));
