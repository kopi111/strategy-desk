(function (APA) {
  'use strict';

  const { $, escapeHtml, format, trendTone, emptyState, segmented } = APA.ui;
  const CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const COLORS = APA.chartColors;

  const view = {
    title: 'Chart',
    subtitle: 'Candles with APA zones, signals and the trade plan',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.chart = null;
      this.loadedKey = null;
      this.stopStream = null;
      this.chartTimes = new Set();
      section.innerHTML = `
        <div class="grid grid-sidebar">
          <div class="panel">
            <div class="chart-toolbar">
              <div class="segmented" data-slot="timeframes" role="radiogroup" aria-label="Chart timeframe"></div>
              <label class="toggle"><input type="checkbox" data-toggle="showZones"> Zones</label>
              <label class="toggle"><input type="checkbox" data-toggle="showMarkers"> Signals</label>
              <label class="toggle"><input type="checkbox" data-toggle="showTradeLines"> Entry / SL / TP</label>
              <span class="spacer"></span>
              <button class="button button-ghost button-small" data-action="latest">Latest</button>
              <button class="button button-ghost button-small" data-action="fit">Fit all</button>
            </div>
            <div class="chart-box" data-slot="chart" aria-label="Price chart">
              <div class="chart-legend" data-slot="legend"></div>
            </div>
            <div class="legend-keys">
              <span class="bull"><i></i>Buy zone</span><span class="bear"><i></i>Sell zone</span>
              <span style="color:${COLORS.accent}"><i style="border-top-style:solid"></i>Entry</span>
              <span class="bear"><i style="border-top-style:solid"></i>Stop loss</span><span class="bull"><i style="border-top-style:solid"></i>Target</span>
              <span>▲▼ signal candle · ● exit with result</span>
            </div>
          </div>
          <div class="grid" style="align-content:start">
            <div class="panel" data-slot="explain"></div>
            <div class="panel" data-slot="zones"></div>
          </div>
        </div>`;
      section.querySelectorAll('[data-toggle]').forEach((input) => {
        input.checked = Boolean(app.settings.chart[input.dataset.toggle]);
        input.addEventListener('change', () => {
          app.settings.chart[input.dataset.toggle] = input.checked;
          APA.settings.save(app.settings);
          this.drawOverlays();
        });
      });
      section.addEventListener('click', (event) => this.handleClick(event));
      app.on('analysis', () => { if (!section.hidden) this.refresh(); else this.renderSide(); });
      app.on('symbol', () => { this.loadedKey = null; });
    },

    show() {
      this.renderTimeframes();
      this.refresh();
    },

    renderTimeframes() {
      const current = this.app.settings.selected.chartTimeframe;
      segmented($('[data-slot="timeframes"]', this.section), CHART_TIMEFRAMES.map((key) => ({ value: key, label: APA.timeframes.byKey(key).label })),
        current, (value) => {
          this.app.settings.selected.chartTimeframe = value;
          APA.settings.save(this.app.settings);
          this.refresh();
        });
    },

    ensureChart() {
      if (this.chart) return true;
      try {
        this.chart = new APA.PriceChart($('[data-slot="chart"]', this.section));
        return true;
      } catch (error) {
        $('[data-slot="chart"]', this.section).innerHTML = emptyState('Chart unavailable', error.message, 'chart');
        return false;
      }
    },

    async refresh() {
      this.renderSide();
      if (!this.app.market.feed || !this.ensureChart()) return;
      const symbol = this.app.symbol;
      const timeframe = APA.timeframes.byKey(this.app.settings.selected.chartTimeframe);
      const key = `${symbol}:${timeframe.key}:${this.app.market.status.kind}`;
      if (key !== this.loadedKey) await this.loadCandles(symbol, timeframe, key);
      this.drawOverlays();
      if (this.app.chartFocusTime) { this.chart.focusTime(this.app.chartFocusTime); this.app.chartFocusTime = null; }
    },

    async loadCandles(symbol, timeframe, key) {
      const box = $('[data-slot="chart"]', this.section);
      const spinner = document.createElement('div');
      spinner.className = 'chart-loading';
      spinner.innerHTML = '<span><span class="spinner"></span>Loading candles…</span>';
      box.appendChild(spinner);
      try {
        const instrument = this.app.instrument(symbol);
        const candles = await this.app.market.chartCandles(symbol, timeframe.seconds);
        this.chart.setCandles(candles, instrument.decimals);
        this.chartTimes = new Set(candles.map((candle) => candle.time));
        this.chart.showRecent(timeframe.seconds >= 14400 ? 120 : 180);
        this.loadedKey = key;
        this.renderWatermark();
        this.renderLegend(candles[candles.length - 1], instrument, timeframe);
        this.streamLive(symbol, timeframe, instrument);
      } catch (error) {
        APA.ui.toast(`Chart: ${error.message}`, 'error');
      } finally {
        spinner.remove();
      }
    },

    streamLive(symbol, timeframe, instrument) {
      if (this.stopStream) this.stopStream();
      this.stopStream = this.app.market.subscribe(symbol, timeframe.seconds, (candle) => {
        if (symbol !== this.app.symbol) return;
        this.chart.updateCandle(candle);
        this.chartTimes.add(candle.time);
        this.renderLegend(candle, instrument, timeframe);
      });
    },

    renderWatermark() {
      const box = $('[data-slot="chart"]', this.section);
      const existing = $('.chart-watermark', box);
      if (existing) existing.remove();
      if (this.app.market.status.kind !== 'demo') return;
      const mark = document.createElement('div');
      mark.className = 'chart-watermark';
      mark.textContent = 'DEMO';
      box.appendChild(mark);
    },

    renderLegend(candle, instrument, timeframe) {
      if (!candle) return;
      $('[data-slot="legend"]', this.section).innerHTML = `<b>${escapeHtml(instrument.shortName)}</b><span>${timeframe.label}</span>
        <span>O ${format.price(instrument, candle.open)}</span><span>H ${format.price(instrument, candle.high)}</span>
        <span>L ${format.price(instrument, candle.low)}</span><span>C <b>${format.price(instrument, candle.close)}</b></span>`;
    },

    drawOverlays() {
      const analysis = this.app.analysis;
      if (!this.chart || !analysis || analysis.symbol !== this.app.symbol) return;
      const options = this.app.settings.chart;
      const instrument = this.app.instrument();
      const chartSeconds = APA.timeframes.byKey(this.app.settings.selected.chartTimeframe).seconds;
      this.chart.clearOverlays();

      if (options.showZones) {
        for (const state of analysis.signal.liveZones.slice(0, options.maxZonesShown)) {
          const model = APA.zones.model(state.zone.model);
          this.chart.addLine(state.zone.level, `${model.short} ${state.zone.direction === 'buy' ? 'BUY' : 'SELL'}`, state.zone.direction === 'buy' ? COLORS.bull : COLORS.bear, 2, 1);
        }
      }
      const plan = analysis.signal.plan;
      if (options.showTradeLines && plan && plan.ok !== false) {
        const label = plan.kind === 'active' ? '' : ' (proposed)';
        this.chart.addLine(plan.entry, `Entry${label}`, COLORS.accent, 0, 2);
        this.chart.addLine(plan.kind === 'active' ? plan.stop : plan.initialStop, 'Stop loss', COLORS.bear, 0, 2);
        if (plan.partialTarget) this.chart.addLine(plan.partialTarget, 'TP1 50%', COLORS.bull, 1, 1);
        this.chart.addLine(plan.target, plan.liquidity ? 'Target: liquidity' : 'Target', COLORS.bull, 0, 2);
      }
      if (options.showMarkers) this.chart.setMarkers(this.markers(analysis, chartSeconds, instrument));
    },

    markers(analysis, chartSeconds, instrument) {
      const entrySeconds = analysis.timeframeSeconds.entry;
      const toBar = (time) => Math.floor(time / chartSeconds) * chartSeconds;
      const markers = [];
      for (const trade of analysis.simulation.trades) {
        const buying = trade.direction === 'buy';
        const entryBar = toBar(trade.entryTime - entrySeconds);
        if (this.chartTimes.has(entryBar)) {
          markers.push({ time: entryBar, position: buying ? 'belowBar' : 'aboveBar', color: buying ? COLORS.bull : COLORS.bear,
            shape: buying ? 'arrowUp' : 'arrowDown', text: `${buying ? 'BUY' : 'SELL'} ${APA.zones.model(trade.model).short}` });
        }
        const exitBar = trade.exitTime ? toBar(trade.exitTime - entrySeconds) : null;
        if (exitBar !== null && this.chartTimes.has(exitBar)) {
          markers.push({ time: exitBar, position: buying ? 'aboveBar' : 'belowBar', color: trade.netR > 0 ? COLORS.bull : COLORS.bear,
            shape: 'circle', text: format.r(trade.netR) });
        }
      }
      for (const state of analysis.signal.liveZones.slice(0, this.app.settings.chart.maxZonesShown)) {
        const bar = toBar(state.zone.sourceTime);
        if (!this.chartTimes.has(bar)) continue;
        markers.push({ time: bar, position: state.zone.direction === 'sell' ? 'aboveBar' : 'belowBar', color: COLORS.wait, shape: 'square',
          text: `${APA.zones.model(state.zone.model).short} ${format.price(instrument, state.zone.level)}` });
      }
      return markers;
    },

    renderSide() {
      const analysis = this.app.analysis;
      const instrument = this.app.instrument();
      const explain = $('[data-slot="explain"]', this.section);
      const zonesSlot = $('[data-slot="zones"]', this.section);
      if (!analysis) {
        explain.innerHTML = emptyState('No analysis yet', this.app.analysisError || 'Loading candles…');
        zonesSlot.innerHTML = '';
        return;
      }
      const { signal } = analysis;
      const focus = signal.focus;
      const plan = signal.plan;
      const model = focus ? APA.zones.model(focus.zone.model) : null;
      explain.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.zap}Why this signal</h2><p>${format.time(signal.now)}</p></div>
          <span class="tag tag-${{ BUY: 'bull', SELL: 'bear', WAIT: 'wait' }[signal.status] || ''}">${signal.status}</span></div>
        <div class="explain">
          <p>${escapeHtml(signal.headline)}</p>
          ${model ? `<p><strong>${escapeHtml(model.name)}</strong> <span class="muted">(${escapeHtml(model.video)})</span><br>${escapeHtml(focus.zone.explanation)}</p>
            ${focus.zone.alsoMatches.length ? `<p class="muted">Same level also fits: ${focus.zone.alsoMatches.map((id) => escapeHtml(APA.zones.model(id).name)).join(', ')}.</p>` : ''}
            <p class="muted">${escapeHtml(focus.reason)}</p>` : ''}
          <dl>
            <dt>Bias (${APA.timeframes.bySeconds(analysis.timeframeSeconds.bias).label})</dt><dd class="${trendTone(signal.biasTrend)}">${format.trend(signal.biasTrend)}</dd>
            ${focus ? `<dt>Zone level</dt><dd>${format.price(instrument, focus.zone.level)}</dd><dt>Zone formed</dt><dd>${format.time(focus.zone.availableTime)}</dd>` : ''}
            ${plan ? `<dt>Entry</dt><dd>${format.price(instrument, plan.entry)}</dd><dt>Stop loss</dt><dd class="bear">${format.price(instrument, plan.initialStop ?? plan.stop)}</dd>
              <dt>Target</dt><dd class="bull">${plan.ok === false ? '—' : format.price(instrument, plan.target)}</dd><dt>Reward : risk</dt><dd>${format.ratio(plan.rewardToRisk)}</dd>` : ''}
          </dl>
          ${plan && plan.ok === false ? `<div class="note"><strong>No trade:</strong> ${escapeHtml(plan.reason)}</div>` : ''}
        </div>`;
      const zones = signal.liveZones;
      zonesSlot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.layers}Zones on the chart</h2><p>Nearest ${Math.min(zones.length, this.app.settings.chart.maxZonesShown)} of ${zones.length}</p></div></div>
        ${zones.length ? `<ul class="zone-list">${zones.slice(0, this.app.settings.chart.maxZonesShown).map((state) => `
          <li data-action="focus" data-time="${state.zone.sourceTime}" tabindex="0"><span class="bar ${state.zone.direction}"></span>
            <div><strong>${escapeHtml(APA.zones.model(state.zone.model).name)}</strong><small>${state.zone.direction === 'buy' ? 'Buy' : 'Sell'} ${format.price(instrument, state.zone.level)} · formed ${format.time(state.zone.availableTime)}</small></div>
            <span class="tag ${state.status === 'tapped' ? 'tag-wait' : ''}">${state.status === 'tapped' ? 'At level' : 'Waiting'}</span></li>`).join('')}</ul>`
          : emptyState('No active zones', 'Nothing is waiting for price right now.')}`;
    },

    handleClick(event) {
      const target = event.target.closest('[data-action]');
      if (!target || !this.chart) return;
      if (target.dataset.action === 'latest') this.chart.showRecent();
      if (target.dataset.action === 'fit') this.chart.chart.timeScale().fitContent();
      if (target.dataset.action === 'focus') this.chart.focusTime(Math.floor(Number(target.dataset.time)));
    },
  };

  APA.views = APA.views || {};
  APA.views.chart = view;
})((globalThis.APA = globalThis.APA || {}));
