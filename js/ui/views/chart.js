(function (APA) {
  'use strict';

  const { $, $$, escapeHtml, format, trendTone, emptyState, segmented } = APA.ui;
  const CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const COLORS = APA.chartColors;
  const RECENT_EVENTS_LISTED = 8;
  const DAILY_BARS_SHOWN = 270;
  const TRADE_PLAN_REFRESH_MS = 60000;
  const TRADE_LINE_COLORS = { entry: '#1d4ed8', stop: '#dc2626', target: '#059669' };

  // Each range button picks a sensible timeframe and how many of its candles to show, as Deriv's chart does.
  const RANGES = {
    '6m': { timeframe: '1d', bars: 180 }, '3m': { timeframe: '1d', bars: 90 }, '1m': { timeframe: '4h', bars: 180 },
    '5d': { timeframe: '15m', bars: 480 }, '1d': { timeframe: '5m', bars: 288 },
  };

  // Only tools that really work are listed here.
  const TOOL_BUTTONS = [
    { action: 'cross', icon: 'crosshair', title: 'Crosshair' },
    { action: 'trend', icon: 'trendLine', title: 'Trend line: click two points' },
    { action: 'hline', icon: 'horizontalLine', title: 'Horizontal line: click a price' },
    { action: 'measure', icon: 'ruler', title: 'Measure: click two points' },
    { action: 'zoom', icon: 'zoomIn', title: 'Zoom in' },
    { action: 'magnet', icon: 'magnet', title: 'Magnet: snap to candle prices' },
    { action: 'hide', icon: 'eye', title: 'Hide or show your drawings' },
    { action: 'clear', icon: 'trash', title: 'Delete your drawings on this market' },
  ];
  const DRAWING_TOOLS = ['cross', 'trend', 'hline', 'measure'];

  const view = {
    title: 'Chart',
    subtitle: 'Live candles marked up with structure, gaps, order blocks and sweeps',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.chart = null;
      this.loadedKey = null;
      this.stopStream = null;
      this.chartTimes = new Set();
      this.candles = [];
      this.tools = null;
      this.pendingBars = null;
      section.innerHTML = `
        <div class="deriv-chart">
          <div class="deriv-top">
            <select class="full-market" data-slot="full-market" aria-label="Market"></select>
            <div class="segmented" data-slot="timeframes" role="radiogroup" aria-label="Chart timeframe"></div>
            <div class="markup-toggles" data-slot="markup-toggles" aria-label="What to draw on the chart"></div>
          </div>
          <div class="deriv-body">
            <div class="tool-rail" data-slot="tool-rail" aria-label="Chart tools">
              ${TOOL_BUTTONS.map((tool) => `<button type="button" class="tool-button" data-tool-action="${tool.action}" title="${tool.title}" aria-label="${tool.title}" aria-pressed="${tool.action === 'cross'}">${APA.icons[tool.icon]}</button>`).join('')}
            </div>
            <div class="chart-box" data-slot="chart" aria-label="Price chart">
              <div class="chart-legend" data-slot="legend"></div>
              <div class="trade-card" data-slot="trade-card" hidden></div>
            </div>
          </div>
          <div class="deriv-bottom">
            <div class="range-buttons" data-slot="ranges">${Object.keys(RANGES).map((range) => `<button type="button" data-range="${range}">${range}</button>`).join('')}</div>
            <button type="button" class="range-link" data-action="latest">Latest</button>
            <button type="button" class="range-link" data-action="fit">Fit all</button>
            <button type="button" class="range-link" data-action="toggle-details" aria-expanded="true">Hide details</button>
            <button type="button" class="range-link" data-action="toggle-trade-lines"></button>
            <button type="button" class="range-link" data-action="toggle-full-view"></button>
            <span class="spacer"></span>
            <span class="deriv-clock" data-slot="utc-clock"></span>
            <button type="button" class="scale-button" data-scale="percent" aria-pressed="false">%</button>
            <button type="button" class="scale-button" data-scale="log" aria-pressed="false">log</button>
            <button type="button" class="scale-button" data-scale="auto" aria-pressed="true">auto</button>
          </div>
        </div>
        <div data-slot="details">
        <div class="legend-keys">
          <span>▲ bullish · ▼ bearish · faded box = price has already been there · solid line = BOS · dashed line = MSS or sweep</span>
          <label class="toggle"><input type="checkbox" data-toggle="showApaZones"> APA zones</label>
          <label class="toggle"><input type="checkbox" data-toggle="showApaMarkers"> APA signals</label>
          <label class="toggle"><input type="checkbox" data-toggle="showApaTradeLines"> APA entry / SL / TP</label>
        </div>
        <div class="chart-panels">
          <div class="panel" data-slot="structure"></div>
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
      this.renderMarkupToggles();
      this.applyDetailsVisibility();
      this.prepareFullView();
      this.tickUtcClock();
      setInterval(() => this.tickUtcClock(), 1000);
      setInterval(() => { if (!section.hidden) this.loadTradePlan(); }, TRADE_PLAN_REFRESH_MS);
      this.syncTradeButton();
      section.addEventListener('click', (event) => this.handleClick(event));
      app.on('analysis', () => { if (!section.hidden) this.refresh(); else this.renderSide(); });
      // Start the chart straight away, so it is in the queue ahead of the slower strategy analysis.
      app.on('symbol', () => { this.loadedKey = null; if (!section.hidden) this.refresh(); });
    },

    show() {
      this.renderTimeframes();
      this.renderMarkupToggles();
      this.refresh();
    },

    /** One coloured tick box per concept, saved as soon as it changes. */
    renderMarkupToggles() {
      const slot = $('[data-slot="markup-toggles"]', this.section);
      const { markup } = this.app.settings.chart;
      slot.innerHTML = APA.smartMoney.concepts.map((concept) => `
        <label class="toggle" title="${escapeHtml(concept.summary)}" style="color:${APA.conceptColors[concept.id]}">
          <input type="checkbox" data-markup="${concept.id}" ${markup[concept.id] ? 'checked' : ''}> ${escapeHtml(concept.short)}</label>`).join('');
      slot.onchange = (event) => {
        markup[event.target.dataset.markup] = event.target.checked;
        APA.settings.save(this.app.settings);
        this.drawMarkup();
      };
    },

    /** Works out the markup again from the chart's own closed candles. A forming candle is never used. */
    updateMarkup(candles, timeframe) {
      const closed = APA.candles.closedOnly(candles, timeframe.seconds, Math.floor(Date.now() / 1000));
      this.markupAnalysis = APA.smartMoney.analyze(closed, { timeframeSeconds: timeframe.seconds });
      this.drawMarkup();
    },

    /** Sends the ticked concepts to the chart and refreshes the list beside it. */
    drawMarkup() {
      if (!this.chart || !this.markupAnalysis) return;
      this.chart.setMarkup(APA.smartMoney.drawingsFor(this.markupAnalysis, this.app.settings.chart.markup));
      this.renderStructurePanel();
    },

    /** Lists the trend and the latest events of the ticked concepts. Clicking one jumps to it on the chart. */
    renderStructurePanel() {
      const slot = $('[data-slot="structure"]', this.section);
      const analysis = this.markupAnalysis;
      const instrument = this.app.instrument();
      const { markup } = this.app.settings.chart;
      const recent = analysis.events.filter((event) => markup[event.concept]).slice(-RECENT_EVENTS_LISTED).reverse();
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.layers}Latest on this chart</h2><p>Closed candles only</p></div>
          <span class="tag tag-${{ up: 'bull', down: 'bear' }[analysis.trend] || 'wait'}">${format.trend(analysis.trend)}</span></div>
        ${recent.length ? `<ul class="zone-list" data-slot="recent-events">${recent.map((event) => `
          <li data-action="focus" data-time="${event.time}" tabindex="0"><span class="bar ${event.direction}"></span>
            <div><strong>${escapeHtml(event.message)}</strong><small>${format.price(instrument, event.price)} · ${format.time(event.time)}</small></div></li>`).join('')}</ul>`
          : emptyState('Nothing ticked', 'Tick a concept above the chart to see it here.')}`;
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
        this.chart = new APA.PriceChart($('[data-slot="chart"]', this.section), { isLight: true });
        this.tools = new APA.ChartTools(this.chart, $('[data-slot="chart"]', this.section));
        // Dragging the price scale turns automatic fitting off inside the library, so the button is updated afterwards.
        $('[data-slot="chart"]', this.section).addEventListener('pointerup', () => setTimeout(() => this.syncAutoButton()));
        // The legend follows the mouse, and goes back to the newest candle when the mouse leaves the chart.
        this.chart.chart.subscribeCrosshairMove((event) => this.showHoveredCandle(event));
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
      // The same chart may already be on its way, in which case there is no need to fetch it twice.
      if (key !== this.loadedKey && key !== this.loadingKey) await this.loadCandles(symbol, timeframe, key);
      this.drawOverlays();
      if (this.app.chartFocusTime) { this.chart.focusTime(this.app.chartFocusTime); this.app.chartFocusTime = null; }
    },

    async loadCandles(symbol, timeframe, key) {
      this.loadingKey = key;
      const box = $('[data-slot="chart"]', this.section);
      const spinner = document.createElement('div');
      spinner.className = 'chart-loading';
      spinner.innerHTML = '<span><span class="spinner"></span>Loading candles…</span>';
      box.appendChild(spinner);
      try {
        const instrument = this.app.instrument(symbol);
        const candles = await this.app.market.chartCandles(symbol, timeframe.seconds);
        // If the trader has already switched again, this answer is out of date and must not be drawn.
        if (key !== this.loadingKey) return;
        this.chart.setCandles(candles, instrument.decimals);
        // A dragged price scale keeps its old range, which would put another market's candles off-screen.
        this.chart.setAutoScale(true);
        this.syncAutoButton();
        this.chartTimes = new Set(candles.map((candle) => candle.time));
        this.candles = candles;
        this.tools.useMarket(symbol, candles);
        this.chart.showRecent(this.pendingBars || (timeframe.seconds >= 86400 ? DAILY_BARS_SHOWN : 180));
        this.pendingBars = null;
        this.loadedKey = key;
        this.renderWatermark();
        this.renderLegend(candles[candles.length - 1], instrument, timeframe);
        this.updateMarkup(candles, timeframe);
        this.streamLive(symbol, timeframe, instrument);
        // This runs behind the chart, so the candles never wait for it.
        this.loadTradePlan();
      } catch (error) {
        APA.ui.toast(`Chart: ${error.message}`, 'error');
      } finally {
        spinner.remove();
        if (key === this.loadingKey) this.loadingKey = null;
      }
    },

    streamLive(symbol, timeframe, instrument) {
      if (this.stopStream) this.stopStream();
      this.stopStream = this.app.market.subscribe(symbol, timeframe.seconds, (candle) => {
        if (symbol !== this.app.symbol) return;
        // A candle with a new time means the previous candle has just closed, so the markup can change.
        const aCandleClosed = this.chart.lastTime !== null && candle.time > this.chart.lastTime;
        this.chart.updateCandle(candle);
        this.chartTimes.add(candle.time);
        this.rememberCandle(candle);
        this.renderLegend(candle, instrument, timeframe);
        if (aCandleClosed) this.refreshMarkupAfterClose(symbol, timeframe);
      });
    },

    /** Works out this market's potential trade from live prices. Demo candles must never suggest a trade. */
    async loadTradePlan() {
      const symbol = this.app.symbol;
      if (!this.chart || this.isLoadingPlan) return;
      if (this.app.market.status.kind !== 'live') { this.showTradePlan({ status: 'none', side: 'none', reason: 'Potential trades only run on live Deriv prices.' }, symbol); return; }
      this.isLoadingPlan = true;
      try {
        const plan = await APA.potentialTrade.forMarket(this.app.market, symbol);
        if (symbol === this.app.symbol) this.showTradePlan(plan, symbol);
      } catch (error) {
        console.warn('[chart] could not work out the potential trade', error);
        if (symbol === this.app.symbol) this.showTradePlan({ status: 'none', side: 'none', reason: 'Could not check: Deriv did not answer.' }, symbol);
      } finally {
        this.isLoadingPlan = false;
        // The trader may have changed market while this was running.
        if (symbol !== this.app.symbol) this.loadTradePlan();
      }
    },

    /** Draws the buy or sell, stop and take profit lines, and fills the card with the levels and the backtest result. */
    showTradePlan(plan, symbol) {
      const isShown = this.app.settings.chart.showPotentialTrade;
      const hasLevels = plan.status !== 'none';
      const instrument = this.app.instrument(symbol);
      const price = (value) => format.price(instrument, value);
      this.chart.setTradeLines(isShown && hasLevels ? [
        { price: plan.entry, title: plan.side.toUpperCase(), color: TRADE_LINE_COLORS.entry },
        { price: plan.stop, title: 'STOP', color: TRADE_LINE_COLORS.stop },
        { price: plan.target, title: 'TP', color: TRADE_LINE_COLORS.target },
      ] : []);
      const card = $('[data-slot="trade-card"]', this.section);
      card.hidden = !isShown;
      const proof = APA.potentialTradeBacktest.describe(symbol);
      card.innerHTML = hasLevels ? `
        <strong class="${plan.side === 'buy' ? 'bull' : 'bear'}">${plan.side.toUpperCase()} ${plan.status === 'ready' ? 'now' : 'on a pullback'}</strong>
        <span>Entry ${price(plan.entry)} · Stop ${price(plan.stop)} · TP ${price(plan.target)} · ${plan.rewardToRisk.toFixed(1)}R</span>
        <small class="${proof.tone}">${escapeHtml(proof.text)}</small>` : `
        <strong>No trade</strong><span>${escapeHtml(plan.reason)}</span>`;
    },

    /** Words the show or hide button for what a click will do. */
    syncTradeButton() {
      $('[data-action="toggle-trade-lines"]', this.section).textContent = this.app.settings.chart.showPotentialTrade ? 'Hide trade' : 'Show trade';
    },

    /** Downloads fresh candles after a close, because polling can miss candles while the tab is in the background. */
    async refreshMarkupAfterClose(symbol, timeframe) {
      try {
        const candles = await this.app.market.chartCandles(symbol, timeframe.seconds);
        const chartStillShowsThis = symbol === this.app.symbol && timeframe.key === this.app.settings.selected.chartTimeframe;
        if (chartStillShowsThis) this.updateMarkup(candles, timeframe);
      } catch (error) {
        console.warn('[chart] could not refresh the markup after a candle closed', error);
        APA.ui.toast('Chart markup is out of date: Deriv did not answer.', 'error');
      }
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

    /** Keeps the candle list current, so the tools and the legend's change figure can use the live candle. */
    rememberCandle(candle) {
      const last = this.candles[this.candles.length - 1];
      if (last && last.time === candle.time) this.candles[this.candles.length - 1] = candle;
      else this.candles.push(candle);
    },

    /** Shows the candle under the mouse in the legend, or the newest candle when the mouse is away. */
    showHoveredCandle(event) {
      const hovered = event.seriesData && event.seriesData.get(this.chart.series);
      const timeframe = APA.timeframes.byKey(this.app.settings.selected.chartTimeframe);
      this.renderLegend(hovered || this.candles[this.candles.length - 1], this.app.instrument(), timeframe);
    },

    /** Writes the name, timeframe, prices and change from the previous close, in the candle's colour. */
    renderLegend(candle, instrument, timeframe) {
      if (!candle) return;
      const index = APA.candles.lastIndexAtOrBefore(this.candles, candle.time);
      const previousClose = index > 0 ? this.candles[index - 1].close : candle.open;
      const change = candle.close - previousClose;
      const tone = change >= 0 ? 'legend-up' : 'legend-down';
      const price = (value) => format.price(instrument, value);
      $('[data-slot="legend"]', this.section).innerHTML = `<b>${escapeHtml(instrument.name)}</b><span>· ${timeframe.label} ·</span>
        <span class="${tone}"><i>O</i>${price(candle.open)}</span><span class="${tone}"><i>H</i>${price(candle.high)}</span>
        <span class="${tone}"><i>L</i>${price(candle.low)}</span><span class="${tone}"><i>C</i>${price(candle.close)}</span>
        <span class="${tone}">${change >= 0 ? '+' : ''}${price(change)} (${change >= 0 ? '+' : ''}${((change / previousClose) * 100).toFixed(2)}%)</span>`;
    },

    /** Shows or hides everything under the chart. When hidden, the chart grows into the space. */
    applyDetailsVisibility() {
      const isShown = this.app.settings.chart.showDetails;
      $('[data-slot="details"]', this.section).hidden = !isShown;
      this.section.classList.toggle('is-chart-only', !isShown);
      const button = $('[data-action="toggle-details"]', this.section);
      button.textContent = isShown ? 'Hide details' : 'Show details';
      button.setAttribute('aria-expanded', String(isShown));
    },

    /** Fills the market picker used in full view, and connects the ways of leaving full view. */
    prepareFullView() {
      const picker = $('[data-slot="full-market"]', this.section);
      const syncPicker = () => { picker.innerHTML = APA.ui.instrumentOptions(this.app.instruments, this.app.symbol); };
      syncPicker();
      picker.addEventListener('change', () => this.app.setSymbol(picker.value));
      this.app.on('symbol', syncPicker);
      // Esc leaves browser full screen by itself. When that happens, the chart leaves full view too.
      document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.usedBrowserFullScreen) this.setFullView(false); });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !this.section.hidden && this.app.settings.chart.fullView) this.setFullView(false); });
      this.applyFullView();
    },

    /** Shows the chart filling the window, or back in the normal page. */
    applyFullView() {
      const isFull = this.app.settings.chart.fullView;
      this.section.classList.toggle('is-full-view', isFull);
      $('[data-action="toggle-full-view"]', this.section).textContent = isFull ? 'Exit full screen' : 'Full screen';
    },

    /** Saves the choice and applies it. Browser full screen also hides the browser's own bars, where allowed. */
    setFullView(isFull) {
      this.app.settings.chart.fullView = isFull;
      APA.settings.save(this.app.settings);
      this.applyFullView();
      if (isFull) {
        this.usedBrowserFullScreen = true;
        // The chart still fills the window if the browser refuses, so this failure only needs a log line.
        document.documentElement.requestFullscreen?.().catch((error) => { this.usedBrowserFullScreen = false; console.warn('[chart] browser full screen refused', error); });
      } else {
        this.usedBrowserFullScreen = false;
        if (document.fullscreenElement) document.exitFullscreen();
      }
    },

    /** Updates the clock in the bottom bar. */
    tickUtcClock() {
      $('[data-slot="utc-clock"]', this.section).textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
    },

    /** Runs a button from the tool rail. Drawing tools stay selected; the others act once. */
    useTool(button) {
      const action = button.dataset.toolAction;
      if (DRAWING_TOOLS.includes(action)) {
        this.tools.selectTool(action);
        $$('.tool-button', this.section).filter((item) => DRAWING_TOOLS.includes(item.dataset.toolAction))
          .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      }
      if (action === 'zoom') this.chart.zoomIn();
      if (action === 'magnet') button.setAttribute('aria-pressed', String(this.tools.toggleMagnet()));
      if (action === 'hide') button.setAttribute('aria-pressed', String(this.tools.toggleHidden()));
      if (action === 'clear') { this.tools.clearAll(); APA.ui.toast('Your drawings on this market were deleted.'); }
    },

    /** Runs a range button: changes the timeframe and how many candles are shown. */
    selectRange(range) {
      const { timeframe, bars } = RANGES[range];
      this.pendingBars = bars;
      this.app.settings.selected.chartTimeframe = timeframe;
      APA.settings.save(this.app.settings);
      this.renderTimeframes();
      this.loadedKey = null;
      this.refresh();
    },

    /** Makes the auto button show whether the chart is really fitting its price scale automatically. */
    syncAutoButton() {
      const isOn = this.chart.chart.priceScale('right').options().autoScale;
      $('[data-scale="auto"]', this.section).setAttribute('aria-pressed', String(isOn));
    },

    /** Runs the %, log and auto buttons. % and log exclude each other; both off means a normal price scale. */
    selectScale(button) {
      const nextState = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(nextState));
      if (button.dataset.scale === 'auto') { this.chart.setAutoScale(nextState); return; }
      const other = $(`[data-scale="${button.dataset.scale === 'log' ? 'percent' : 'log'}"]`, this.section);
      other.setAttribute('aria-pressed', 'false');
      this.chart.setScaleMode(nextState ? button.dataset.scale : 'normal');
    },

    drawOverlays() {
      const analysis = this.app.analysis;
      if (!this.chart || !analysis || analysis.symbol !== this.app.symbol) return;
      const options = this.app.settings.chart;
      const instrument = this.app.instrument();
      const chartSeconds = APA.timeframes.byKey(this.app.settings.selected.chartTimeframe).seconds;
      this.chart.clearOverlays();

      if (options.showApaZones) {
        for (const state of analysis.signal.liveZones.slice(0, options.maxZonesShown)) {
          const model = APA.zones.model(state.zone.model);
          this.chart.addLine(state.zone.level, `${model.short} ${state.zone.direction === 'buy' ? 'BUY' : 'SELL'}`, state.zone.direction === 'buy' ? COLORS.bull : COLORS.bear, 2, 1);
        }
      }
      const plan = analysis.signal.plan;
      if (options.showApaTradeLines && plan && plan.ok !== false) {
        const label = plan.kind === 'active' ? '' : ' (proposed)';
        this.chart.addLine(plan.entry, `Entry${label}`, COLORS.accent, 0, 2);
        this.chart.addLine(plan.kind === 'active' ? plan.stop : plan.initialStop, 'Stop loss', COLORS.bear, 0, 2);
        if (plan.partialTarget) this.chart.addLine(plan.partialTarget, 'TP1 50%', COLORS.bull, 1, 1);
        this.chart.addLine(plan.target, plan.liquidity ? 'Target: liquidity' : 'Target', COLORS.bull, 0, 2);
      }
      if (options.showApaMarkers) this.chart.setMarkers(this.markers(analysis, chartSeconds, instrument));
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
      if (!this.chart) return;
      const toolButton = event.target.closest('[data-tool-action]');
      const rangeButton = event.target.closest('[data-range]');
      const scaleButton = event.target.closest('[data-scale]');
      if (toolButton) this.useTool(toolButton);
      if (rangeButton) this.selectRange(rangeButton.dataset.range);
      if (scaleButton) this.selectScale(scaleButton);
      const target = event.target.closest('[data-action]');
      if (!target) return;
      if (target.dataset.action === 'toggle-full-view') this.setFullView(!this.app.settings.chart.fullView);
      if (target.dataset.action === 'toggle-details') {
        this.app.settings.chart.showDetails = !this.app.settings.chart.showDetails;
        APA.settings.save(this.app.settings);
        this.applyDetailsVisibility();
      }
      if (target.dataset.action === 'toggle-trade-lines') {
        this.app.settings.chart.showPotentialTrade = !this.app.settings.chart.showPotentialTrade;
        APA.settings.save(this.app.settings);
        this.syncTradeButton();
        this.loadTradePlan();
      }
      if (target.dataset.action === 'latest') this.chart.showRecent();
      if (target.dataset.action === 'fit') this.chart.chart.timeScale().fitContent();
      if (target.dataset.action === 'focus') this.chart.focusTime(Math.floor(Number(target.dataset.time)));
    },
  };

  APA.views = APA.views || {};
  APA.views.chart = view;
})((globalThis.APA = globalThis.APA || {}));
