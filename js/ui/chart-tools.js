(function (APA) {
  'use strict';

  const STORAGE_KEY = 'strategy-desk.chart-drawings.v1';
  const POINTS_NEEDED = { trend: 2, measure: 2, hline: 1 };
  const MAX_CLICK_MOVEMENT_PIXELS = 4;

  /**
   * Runs the tool rail beside the chart: trend lines, horizontal lines, the measure tool, the magnet and hiding.
   * Trend and horizontal lines are saved per market. A measurement is temporary and is never saved.
   */
  class ChartTools {
    constructor(priceChart, container) {
      this.priceChart = priceChart;
      this.container = container;
      this.tool = 'cross';
      this.isMagnetOn = false;
      this.isHidden = false;
      this.symbol = null;
      this.candles = [];
      this.drawings = [];
      this.draftPoints = [];
      this.measurement = null;
      this.listenForClicks();
      priceChart.chart.subscribeCrosshairMove((event) => this.handleMove(event));
    }

    /**
     * Listens to the chart area directly. The chart library treats any two clicks within half a second as one
     * double-click, even far apart, which would lose the second point of a line. A drag is panning, not a click.
     */
    listenForClicks() {
      let pressedAt = null;
      this.container.addEventListener('pointerdown', (event) => { pressedAt = { x: event.clientX, y: event.clientY }; }, true);
      this.container.addEventListener('pointerup', (event) => {
        if (!pressedAt) return;
        const moved = Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y);
        pressedAt = null;
        if (moved <= MAX_CLICK_MOVEMENT_PIXELS) this.handleClick(event);
      }, true);
    }

    /** Converts a mouse position to chart pixels. Returns null over the price or time scales. */
    panePosition(event) {
      const box = this.container.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      const scale = this.priceChart.chart.timeScale();
      return x <= scale.width() && y <= box.height - scale.height() ? { x, y } : null;
    }

    /** Switches market and loads that market's saved drawings. */
    useMarket(symbol, candles) {
      this.symbol = symbol;
      this.candles = candles;
      const saved = APA.storage.readJson(STORAGE_KEY) || {};
      this.drawings = saved[symbol] || [];
      this.cancelDraft();
    }

    /** Saves this market's drawings, leaving other markets' drawings in place. */
    save() {
      const saved = APA.storage.readJson(STORAGE_KEY) || {};
      saved[this.symbol] = this.drawings;
      APA.storage.writeJson(STORAGE_KEY, saved);
    }

    /** Picks a tool, and drops any half-finished line and old measurement. */
    selectTool(tool) {
      this.tool = tool;
      this.cancelDraft();
    }

    /** Forgets the unfinished line and the measurement, then repaints. */
    cancelDraft() {
      this.draftPoints = [];
      this.measurement = null;
      this.publish();
    }

    /** Turns snapping to candle prices on or off. Returns the new state for the button. */
    toggleMagnet() {
      this.isMagnetOn = !this.isMagnetOn;
      return this.isMagnetOn;
    }

    /** Shows or hides saved drawings without deleting them. Returns the new state for the button. */
    toggleHidden() {
      this.isHidden = !this.isHidden;
      this.publish();
      return this.isHidden;
    }

    /** Deletes this market's drawings. */
    clearAll() {
      this.drawings = [];
      this.save();
      this.cancelDraft();
    }

    /** Places a point for the current tool, and finishes the drawing once it has enough points. */
    handleClick(event) {
      if (this.tool === 'cross') return;
      const position = this.panePosition(event);
      const point = position && this.pointFrom(position);
      if (!point) return;
      if (this.tool === 'measure' && this.measurement) this.measurement = null;
      this.draftPoints.push(point);
      if (this.draftPoints.length >= POINTS_NEEDED[this.tool]) this.finishDrawing();
      else this.publish();
    }

    /** Turns the placed points into a finished drawing. Only real lines are saved. */
    finishDrawing() {
      const [start, end = start] = this.draftPoints;
      this.draftPoints = [];
      if (this.tool === 'measure') {
        this.measurement = { start, end };
      } else {
        this.drawings.push({ type: this.tool, start, end });
        this.save();
      }
      this.publish();
    }

    /** Stretches an unfinished line to the mouse, so the trader sees it before the second click. */
    handleMove(event) {
      if (!this.draftPoints.length || !event.point) return;
      const point = this.pointFrom(event.point);
      if (point) this.publish(point);
    }

    /** Works out the time and price at a chart position. Right of the last candle, it uses the last candle's time. */
    pointFrom({ x, y }) {
      const price = this.priceChart.series.coordinateToPrice(y);
      if (price === null || !this.candles.length) return null;
      const time = this.priceChart.chart.timeScale().coordinateToTime(x) ?? this.candles[this.candles.length - 1].time;
      return { time, price: this.isMagnetOn ? this.snapToCandle(time, price) : price };
    }

    /** With the magnet on, moves the price to the closest open, high, low or close of that candle. */
    snapToCandle(time, price) {
      const candle = this.candles[this.candleIndexAt(time)];
      if (!candle) return price;
      const closest = (best, value) => (Math.abs(value - price) < Math.abs(best - price) ? value : best);
      return [candle.high, candle.low, candle.close].reduce(closest, candle.open);
    }

    /** Moves a time to the candle containing it, so a line drawn on one timeframe still shows on another. */
    candleIndexAt(time) {
      return APA.candles.lastIndexAtOrBefore(this.candles, time);
    }

    /** Converts a stored drawing to what the painter needs. Returns null if it starts before the loaded candles. */
    toPainted(type, start, end) {
      const startIndex = this.candleIndexAt(start.time);
      const endIndex = this.candleIndexAt(end.time);
      if (startIndex < 0 || endIndex < 0) return null;
      return {
        type, startPrice: start.price, endPrice: end.price,
        startTime: this.candles[startIndex].time, endTime: this.candles[endIndex].time,
        bars: Math.abs(endIndex - startIndex),
      };
    }

    /** Sends everything that should be visible to the chart painter. */
    publish(mousePoint = null) {
      const saved = this.isHidden ? [] : this.drawings.map((drawing) => this.toPainted(drawing.type, drawing.start, drawing.end));
      const draft = this.draftPoints.length && mousePoint ? this.toPainted(this.tool, this.draftPoints[0], mousePoint) : null;
      const measured = this.measurement ? this.toPainted('measure', this.measurement.start, this.measurement.end) : null;
      this.priceChart.markup.setUserDrawings([...saved, draft, measured].filter(Boolean));
    }
  }

  APA.ChartTools = ChartTools;
})((globalThis.APA = globalThis.APA || {}));
