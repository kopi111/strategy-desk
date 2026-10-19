(function (APA) {
  'use strict';

  const { escapeHtml, format, emptyState, loading } = APA.ui;

  const STANCE = {
    up: { label: 'Leans up', tone: 'bull', tag: 'tag-bull' },
    down: { label: 'Leans down', tone: 'bear', tag: 'tag-bear' },
    neutral: { label: 'No lean', tone: '', tag: '' },
  };

  /** Dashboard panels for the trained model: its reading on the newest hourly candle and how it tested. */
  class MlPanel {
    constructor(readingSlot, testSlot, app) {
      this.readingSlot = readingSlot;
      this.testSlot = testSlot;
      this.app = app;
      this.state = { status: 'loading' };
      this.requestId = 0;
    }

    async refresh() {
      const requestId = ++this.requestId;
      const symbol = this.app.symbol;
      this.state = { status: 'loading' };
      this.render();
      try {
        const file = await APA.mlModel.load();
        const candles = await this.app.market.closedCandles(symbol, APA.mlModel.HOUR, APA.mlModel.CANDLES_NEEDED + 40);
        if (requestId !== this.requestId) return;
        this.state = { status: 'ready', file, reading: APA.mlModel.read(file, this.app.instrument(symbol), candles) };
      } catch (error) {
        if (requestId !== this.requestId) return;
        console.error('[ml-panel] reading failed', error);
        this.state = { status: 'error', message: error.message };
      }
      this.render();
    }

    render() {
      this.readingSlot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.radar}ML model reading</h2><p>Gradient-boosted trees trained on 10 years of hourly prices</p></div>
          ${this.state.file ? `<span class="tag">Trained ${escapeHtml(this.state.file.trained_at.slice(0, 10))}</span>` : ''}</div>
        ${this.readingBody()}`;
      this.testSlot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.layers}How the model tested</h2><p>Unseen years only, after spread</p></div></div>
        ${this.state.file ? testBody(this.state.file) : loading('Loading the model file…')}`;
    }

    readingBody() {
      if (this.state.status === 'loading') return loading('Reading the newest hourly candle…');
      if (this.state.status === 'error') return emptyState('No model reading', this.state.message);
      const { reading } = this.state;
      const instrument = this.app.instrument();
      const stance = STANCE[reading.stance];
      const isDemo = this.app.sourceStatus && this.app.sourceStatus.kind === 'demo';
      return `
        <div class="ml-reading">
          <div class="ml-figure"><span class="kpi-value ${stance.tone}">${format.percent(reading.probability, 0)}</span><small>chance up first</small></div>
          <div class="ml-copy">
            <div class="signal-tags">
              ${isDemo ? '<span class="tag tag-wait">DEMO DATA: reading is meaningless</span>' : ''}
              <span class="tag ${stance.tag}">${stance.label}</span>
              <span class="tag">${reading.kind === 'synthetic' ? 'Synthetic model' : 'Real-market model'}</span>
            </div>
            <p>Chance that ${escapeHtml(instrument.shortName)} rises ${format.price(instrument, reading.atr)} (1 ATR) before it falls the same distance, within 24 hourly candles.</p>
            <div class="progress ml-meter" aria-hidden="true"><div style="width:${(reading.probability * 100).toFixed(1)}%"></div></div>
            <small class="muted">${agreementText(reading, this.app.analysis)} Candle closed ${format.time(reading.candleTime)}.</small>
          </div>
        </div>`;
    }
  }

  function agreementText(reading, analysis) {
    const status = analysis && analysis.signal.status;
    if (status !== 'BUY' && status !== 'SELL') return 'No APA trade to compare with.';
    if (reading.stance === 'neutral') return `The model has no lean on this APA ${status}.`;
    const agrees = (status === 'BUY') === (reading.stance === 'up');
    return agrees ? `Agrees with the APA ${status}.` : `Disagrees with the APA ${status}.`;
  }

  function testBody(file) {
    const { test } = file;
    const rows = [
      ['Real markets AUC', test.auc.toFixed(3), '0.500 = coin flip'],
      ['Real markets, net after spread', format.r(test.net_r), `${test.trades} test trades`],
      ['Synthetics AUC', test.synthetic_auc.toFixed(3), 'random by design: should be 0.5'],
      ['Synthetics, net after spread', format.r(test.synthetic_net_r), 'expected to be luck'],
    ];
    return `
      <div class="ml-tests">${rows.map(([label, value, note]) => `<div class="plan-cell"><span>${label}</span><strong>${escapeHtml(value)}</strong><small class="muted">${note}</small></div>`).join('')}</div>
      <p class="ml-verdict">${escapeHtml(file.verdict)}</p>`;
  }

  APA.MlPanel = MlPanel;
})((globalThis.APA = globalThis.APA || {}));
