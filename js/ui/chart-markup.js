(function (APA) {
  'use strict';

  // One colour per concept, dark enough to read on the white chart.
  const CONCEPT_COLORS = {
    bos: '#131722', mss: '#e8590c', fvg: '#1c7ed6', ob: '#5c677d', sweep: '#c77700', ifvg: '#7048e8', breaker: '#d6336c',
    ote: '#a67c00', sd: '#0b8a6a', sr: '#364fc7', breakout: '#0f8f83', crt: '#c92a2a', silverBullet: '#8f7500', powerOf3: '#6741d9',
  };
  const USER_LINE_COLOR = '#2962ff';
  const MEASURE_UP_COLOR = '#089981';
  const MEASURE_DOWN_COLOR = '#f23645';
  const LABEL_FONT = '600 11px "JetBrains Mono", monospace';
  const BOX_FILL_ALPHA = '26';
  const USED_BOX_FILL_ALPHA = '12';
  const BOX_BORDER_ALPHA = '88';
  const LABEL_PADDING = 4;
  const LABEL_HEIGHT = 15;

  /** Draws a small label on a dark backing, so it stays readable on top of candles. */
  function drawLabel(context, text, x, y, color) {
    context.font = LABEL_FONT;
    const width = context.measureText(text).width + LABEL_PADDING * 2;
    context.fillStyle = 'rgba(255, 255, 255, 0.88)';
    context.fillRect(x, y, width, LABEL_HEIGHT);
    context.fillStyle = color;
    context.textBaseline = 'middle';
    context.fillText(text, x + LABEL_PADDING, y + LABEL_HEIGHT / 2);
  }

  /** Paints the drawing list onto the chart. It is a plug-in for the chart library, redrawn on every scroll and zoom. */
  class ChartMarkup {
    constructor() {
      this.drawings = [];
      this.userDrawings = [];
      this.chart = null;
      this.series = null;
      this.requestUpdate = null;
      const markup = this;
      this.paneView = {
        renderer: () => ({
          // Boxes go behind the candles; lines and labels go in front.
          drawBackground: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => markup.drawBoxes(context, mediaSize)),
          draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => markup.drawForeground(context, mediaSize)),
        }),
      };
    }

    /** Called by the chart library when this plug-in is attached. */
    attached({ chart, series, requestUpdate }) {
      this.chart = chart;
      this.series = series;
      this.requestUpdate = requestUpdate;
    }

    /** Called by the chart library when this plug-in is removed. */
    detached() {
      this.chart = null;
      this.series = null;
      this.requestUpdate = null;
    }

    /** The chart library asks for this list before painting. */
    paneViews() {
      return [this.paneView];
    }

    /** Required by the chart library. Nothing to do, because positions are worked out while painting. */
    updateAllViews() {}

    /** Replaces what is drawn and asks the chart to repaint. */
    setDrawings(drawings) {
      this.drawings = drawings;
      if (this.requestUpdate) this.requestUpdate();
    }

    /** Replaces the trader's own lines and measurements, and asks the chart to repaint. */
    setUserDrawings(drawings) {
      this.userDrawings = drawings;
      if (this.requestUpdate) this.requestUpdate();
    }

    /** Converts a drawing's time span to pixels. Returns null if its start is not on the loaded chart. */
    horizontalSpan(drawing, paneWidth) {
      const scale = this.chart.timeScale();
      const left = scale.timeToCoordinate(drawing.startTime);
      if (left === null) return null;
      // A drawing with no end time is still in force, so it runs to the right edge.
      const right = drawing.endTime === null ? paneWidth : scale.timeToCoordinate(drawing.endTime);
      return right === null ? null : { left, right };
    }

    /** Paints the shaded zone boxes. */
    drawBoxes(context, size) {
      for (const drawing of this.drawings.filter((item) => item.type === 'box')) {
        const span = this.horizontalSpan(drawing, size.width);
        const top = this.series.priceToCoordinate(drawing.top);
        const bottom = this.series.priceToCoordinate(drawing.bottom);
        if (!span || top === null || bottom === null) continue;
        const color = CONCEPT_COLORS[drawing.concept];
        context.fillStyle = color + (drawing.isUsed ? USED_BOX_FILL_ALPHA : BOX_FILL_ALPHA);
        context.fillRect(span.left, top, span.right - span.left, bottom - top);
        context.strokeStyle = color + BOX_BORDER_ALPHA;
        context.lineWidth = 1;
        context.strokeRect(span.left, top, span.right - span.left, bottom - top);
      }
    }

    /** Paints box labels, structure lines and sweep tags in front of the candles. */
    drawForeground(context, size) {
      for (const drawing of this.drawings) {
        if (drawing.type === 'box') this.drawBoxLabel(context, drawing, size);
        else this.drawLevel(context, drawing, size);
      }
      for (const drawing of this.userDrawings) this.drawUserDrawing(context, drawing, size);
    }

    /** Paints one of the trader's own drawings, using the painter that matches its type. */
    drawUserDrawing(context, drawing, size) {
      const startX = this.chart.timeScale().timeToCoordinate(drawing.startTime);
      const endX = this.chart.timeScale().timeToCoordinate(drawing.endTime);
      const startY = this.series.priceToCoordinate(drawing.startPrice);
      const endY = this.series.priceToCoordinate(drawing.endPrice);
      if (startY === null || endY === null) return;
      if (drawing.type === 'hline') { this.strokeLine(context, 0, startY, size.width, startY, USER_LINE_COLOR); return; }
      if (startX === null || endX === null) return;
      if (drawing.type === 'trend') this.strokeLine(context, startX, startY, endX, endY, USER_LINE_COLOR);
      else this.drawMeasurement(context, drawing, { startX, startY, endX, endY });
    }

    /** Draws one straight blue line. */
    strokeLine(context, fromX, fromY, toX, toY, color) {
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
    }

    /** Shades the measured area and writes the price change, percentage and candle count. */
    drawMeasurement(context, drawing, { startX, startY, endX, endY }) {
      const change = drawing.endPrice - drawing.startPrice;
      const color = change >= 0 ? MEASURE_UP_COLOR : MEASURE_DOWN_COLOR;
      context.fillStyle = `${color}26`;
      context.fillRect(startX, startY, endX - startX, endY - startY);
      const percent = (change / drawing.startPrice) * 100;
      const sign = change >= 0 ? '+' : '';
      drawLabel(context, `${sign}${change.toFixed(2)} (${sign}${percent.toFixed(2)}%) · ${drawing.bars} bars`, Math.min(startX, endX), Math.min(startY, endY) - LABEL_HEIGHT - 2, color);
    }

    /** Names a box. Its label stays on screen while the box is partly scrolled off the left edge. */
    drawBoxLabel(context, drawing, size) {
      const span = this.horizontalSpan(drawing, size.width);
      const top = this.series.priceToCoordinate(drawing.top);
      if (!span || top === null || span.right < 0) return;
      const direction = drawing.direction === 'buy' ? '▲' : '▼';
      drawLabel(context, `${direction} ${drawing.label}`, Math.max(span.left, 0) + 3, top + 2, CONCEPT_COLORS[drawing.concept]);
    }

    /** Draws a line from the swing to the candle that broke or swept it, with the name above its middle. */
    drawLevel(context, drawing, size) {
      const span = this.horizontalSpan(drawing, size.width);
      const y = this.series.priceToCoordinate(drawing.price);
      if (!span || y === null) return;
      const color = CONCEPT_COLORS[drawing.concept];
      context.strokeStyle = color;
      context.lineWidth = drawing.type === 'tag' ? 1 : 1.5;
      // MSS and sweeps are dashed, which sets them apart from a normal BOS line.
      context.setLineDash(drawing.concept === 'bos' ? [] : [5, 4]);
      context.beginPath();
      context.moveTo(span.left, y);
      context.lineTo(span.right, y);
      context.stroke();
      context.setLineDash([]);
      this.drawLevelLabel(context, drawing, span, y, color);
    }

    /** Places a line's name on the side of the line that faces away from the move, where it covers fewer candles. */
    drawLevelLabel(context, drawing, span, y, color) {
      context.font = LABEL_FONT;
      const width = context.measureText(drawing.label).width + LABEL_PADDING * 2;
      const x = (span.left + span.right) / 2 - width / 2;
      const labelY = drawing.direction === 'buy' ? y - LABEL_HEIGHT - 2 : y + 2;
      drawLabel(context, drawing.label, x, labelY, color);
    }
  }

  APA.ChartMarkup = ChartMarkup;
  APA.conceptColors = CONCEPT_COLORS;
})((globalThis.APA = globalThis.APA || {}));
