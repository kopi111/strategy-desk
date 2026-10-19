(function (APA) {
  'use strict';

  // Runs the gradient-boosted trees trained by ml/train_trading.py on hourly closed candles.
  // features() must match ml/trading_features.py exactly; ml/check_parity.mjs compares the two.
  const MODEL_URL = 'ml/output/model.json';
  const HOUR = 3600;
  const CANDLES_NEEDED = 260;
  const RETURN_LAGS = [1, 4, 12, 24, 72];

  function mean(values) {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  function trailing(series, end, length) {
    return end + 1 >= length ? series.slice(end + 1 - length, end + 1) : null;
  }

  function trailingMean(series, end, length) {
    const window = trailing(series, end, length);
    return window && window.every(Number.isFinite) ? mean(window) : NaN;
  }

  function trueRanges(candles) {
    return candles.map((candle, index) => {
      if (index === 0) return candle.high - candle.low;
      const previousClose = candles[index - 1].close;
      return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
    });
  }

  function simpleRsi(closes, end, length = 14) {
    if (end < length) return NaN;
    let gains = 0;
    let losses = 0;
    for (let index = end - length + 1; index <= end; index += 1) {
      const change = closes[index] - closes[index - 1];
      if (change > 0) gains += change; else losses -= change;
    }
    if (losses === 0) return NaN;
    return 100 - 100 / (1 + gains / losses);
  }

  /** Feature vector for the last candle, in the order the model was trained with. */
  function features(candles) {
    const end = candles.length - 1;
    const last = candles[end];
    const closes = candles.map((candle) => candle.close);
    const ranges = trueRanges(candles);
    const atr = trailingMean(ranges, end, 14);
    const fromClose = (level) => (last.close - level) / atr;
    const highest = (length) => Math.max(...trailing(candles, end, length).map((candle) => candle.high));
    const lowest = (length) => Math.min(...trailing(candles, end, length).map((candle) => candle.low));
    const moment = new Date(last.time * 1000);
    return [
      ...RETURN_LAGS.map((lag) => (end >= lag ? fromClose(closes[end - lag]) : NaN)),
      atr / trailingMean(ranges, end, 100),
      simpleRsi(closes, end),
      (highest(24) - last.close) / atr, fromClose(lowest(24)),
      (highest(120) - last.close) / atr, fromClose(lowest(120)),
      fromClose(trailingMean(closes, end, 20)), fromClose(trailingMean(closes, end, 50)), fromClose(trailingMean(closes, end, 200)),
      (last.close - last.open) / atr,
      (last.high - Math.max(last.open, last.close)) / atr,
      (Math.min(last.open, last.close) - last.low) / atr,
      moment.getUTCHours(),
      (moment.getUTCDay() + 6) % 7,
    ];
  }

  function treeValue(tree, vector) {
    let node = tree[0];
    for (;;) {
      const [feature, threshold, left, right, missingGoesLeft, isLeaf, value] = node;
      if (isLeaf) return value;
      const input = vector[feature];
      const goLeft = Number.isFinite(input) ? input <= threshold : missingGoesLeft;
      node = tree[goLeft ? left : right];
    }
  }

  function probabilityUp(model, vector) {
    const raw = model.trees.reduce((total, tree) => total + treeValue(tree, vector), model.baseline);
    return 1 / (1 + Math.exp(-raw));
  }

  function modelKindFor(instrument) {
    return instrument.group === 'Deriv synthetics' ? 'synthetic' : 'real';
  }

  function stanceOf(probability, margin) {
    if (probability > 0.5 + margin) return 'up';
    if (probability < 0.5 - margin) return 'down';
    return 'neutral';
  }

  /** Reading for the newest closed hourly candle: chance price moves 1 ATR up before 1 ATR down. */
  function read(file, instrument, candles) {
    if (candles.length < CANDLES_NEEDED) throw new Error(`Need ${CANDLES_NEEDED} hourly candles, got ${candles.length}.`);
    const kind = modelKindFor(instrument);
    const vector = features(candles);
    const probability = probabilityUp(file.models[kind], vector);
    const atr = trailingMean(trueRanges(candles), candles.length - 1, 14);
    return {
      kind, probability, stance: stanceOf(probability, file.signal_margin),
      atr, lastClose: candles[candles.length - 1].close, candleTime: candles[candles.length - 1].time,
    };
  }

  let loaded = null;

  function load(fetcher = globalThis.fetch) {
    if (!loaded) {
      loaded = fetcher(MODEL_URL).then((response) => {
        if (!response.ok) throw new Error(`ML model file missing (${response.status}). Run ml/train_trading.py.`);
        return response.json();
      });
      loaded.catch(() => { loaded = null; });
    }
    return loaded;
  }

  APA.mlModel = { HOUR, CANDLES_NEEDED, features, probabilityUp, read, load };
})((globalThis.APA = globalThis.APA || {}));
