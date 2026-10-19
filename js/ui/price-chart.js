(function (APA) {
  'use strict';

  const COLORS = { bull: '#22d39b', bear: '#ff5274', wait: '#f5b84a', accent: '#7c95ff', grid: 'rgba(38, 52, 90, 0.35)', text: '#7d8aa8' };

  function requireLibrary() {
    if (!globalThis.LightweightCharts) {
      throw new Error('The chart library did not load (no internet, or unpkg.com is blocked). Charts are off; everything else still works.');
    }
    return globalThis.LightweightCharts;
  }

  function baseOptions(container) {
    return {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: COLORS.text, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: 'rgba(38, 52, 90, 0.8)' },
      timeScale: { borderColor: 'rgba(38, 52, 90, 0.8)', timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: { mode: 0 },
    };
  }

  function keepSized(chart, container) {
    const observer = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth, height: container.clientHeight }));
    observer.observe(container);
    return observer;
  }

  /** Candlestick chart with strategy overlays: zone lines, signal markers and entry / stop / target lines. */
  class PriceChart {
    constructor(container) {
      const library = requireLibrary();
      this.chart = library.createChart(container, baseOptions(container));
      this.series = this.chart.addCandlestickSeries({
        upColor: COLORS.bull, downColor: COLORS.bear, borderVisible: false, wickUpColor: COLORS.bull, wickDownColor: COLORS.bear,
      });
      this.observer = keepSized(this.chart, container);
      this.overlayLines = [];
      this.lastTime = null;
    }

    setCandles(candles, decimals) {
      this.series.applyOptions({ priceFormat: { type: 'price', precision: decimals, minMove: Math.pow(10, -decimals) } });
      this.series.setData(candles);
      this.lastTime = candles.length ? candles[candles.length - 1].time : null;
    }

    updateCandle(candle) {
      if (this.lastTime !== null && candle.time < this.lastTime) return;
      this.series.update(candle);
      this.lastTime = candle.time;
    }

    showRecent(bars = 160) {
      const range = this.chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const total = this.series.data ? this.series.data().length : bars;
      this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - bars), to: total + 6 });
    }

    clearOverlays() {
      for (const line of this.overlayLines) this.series.removePriceLine(line);
      this.overlayLines = [];
      this.series.setMarkers([]);
    }

    addLine(price, title, color, style = 2, width = 1) {
      this.overlayLines.push(this.series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    }

    setMarkers(markers) {
      this.series.setMarkers(markers.slice().sort((first, second) => first.time - second.time));
    }

    focusTime(time, bars = 120) {
      const data = this.series.data ? this.series.data() : [];
      const index = data.findIndex((candle) => candle.time >= time);
      if (index < 0) return;
      this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, index - bars / 2), to: index + bars / 2 });
    }

    destroy() {
      this.observer.disconnect();
      this.chart.remove();
    }
  }

  /** Small area chart for equity curves. */
  class EquityChart {
    constructor(container) {
      const library = requireLibrary();
      this.chart = library.createChart(container, { ...baseOptions(container), handleScroll: false, handleScale: false });
      this.series = this.chart.addAreaSeries({ lineColor: COLORS.accent, topColor: 'rgba(124, 149, 255, 0.35)', bottomColor: 'rgba(124, 149, 255, 0.02)', lineWidth: 2 });
      this.observer = keepSized(this.chart, container);
    }

    setPoints(points) {
      // Lightweight Charts needs strictly increasing times; nudge trades that closed in the same second.
      let previous = -Infinity;
      const data = points.map((point) => {
        const time = Math.max(point.time, previous + 1);
        previous = time;
        return { time, value: Number(point.value.toFixed(2)) };
      });
      this.series.setData(data);
      this.chart.timeScale().fitContent();
    }

    destroy() {
      this.observer.disconnect();
      this.chart.remove();
    }
  }

  APA.PriceChart = PriceChart;
  APA.EquityChart = EquityChart;
  APA.chartColors = COLORS;
})((globalThis.APA = globalThis.APA || {}));
