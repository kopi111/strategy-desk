(function (APA) {
  'use strict';

  const bodyTop = (candle) => Math.max(candle.open, candle.close);
  const bodyBottom = (candle) => Math.min(candle.open, candle.close);
  const bodySize = (candle) => Math.abs(candle.close - candle.open);
  const range = (candle) => candle.high - candle.low;
  const upperWick = (candle) => candle.high - bodyTop(candle);
  const lowerWick = (candle) => bodyBottom(candle) - candle.low;
  const isBullish = (candle) => candle.close > candle.open;
  const isBearish = (candle) => candle.close < candle.open;

  // Rejection-candle shapes named in the videos (V2 19:40, 41:22, 46:04; V1 4:14).
  function isBullishEngulfing(previous, current) {
    return isBearish(previous) && isBullish(current)
      && current.close >= previous.open && current.open <= previous.close
      && bodySize(current) > bodySize(previous);
  }

  function isBearishEngulfing(previous, current) {
    return isBullish(previous) && isBearish(current)
      && current.close <= previous.open && current.open >= previous.close
      && bodySize(current) > bodySize(previous);
  }

  function isBullishPinBar(candle) {
    const size = range(candle);
    return size > 0 && lowerWick(candle) / size >= 0.6 && bodySize(candle) / size <= 0.35;
  }

  function isBearishPinBar(candle) {
    const size = range(candle);
    return size > 0 && upperWick(candle) / size >= 0.6 && bodySize(candle) / size <= 0.35;
  }

  function isDoji(candle) {
    const size = range(candle);
    return size > 0 && bodySize(candle) / size <= 0.1;
  }

  function isInsideBar(previous, current) {
    return current.high <= previous.high && current.low >= previous.low;
  }

  /** Mean high-low range of the `lookback` candles ending at endIndex. Used to scale buffers per instrument. */
  function averageRange(candles, endIndex, lookback = 50) {
    return averageOf(candles, endIndex, lookback, range);
  }

  function averageBody(candles, endIndex, lookback = 20) {
    return averageOf(candles, endIndex, lookback, bodySize);
  }

  function averageOf(candles, endIndex, lookback, measure) {
    const start = Math.max(0, endIndex - lookback + 1);
    let total = 0;
    for (let index = start; index <= endIndex; index++) total += measure(candles[index]);
    return total / Math.max(1, endIndex - start + 1);
  }

  /** Builds higher-timeframe candles by bucketing on UTC-aligned boundaries (matches Deriv's own buckets). */
  function resample(candles, targetSeconds) {
    const result = [];
    let bucket = null;
    for (const candle of candles) {
      const bucketTime = Math.floor(candle.time / targetSeconds) * targetSeconds;
      if (!bucket || bucket.time !== bucketTime) {
        bucket = { time: bucketTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close };
        result.push(bucket);
        continue;
      }
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
    }
    return result;
  }

  /** Drops the still-forming last candle so no decision is ever made on an unfinished bar. */
  function closedOnly(candles, timeframeSeconds, nowSeconds) {
    if (!candles.length) return candles;
    const last = candles[candles.length - 1];
    return last.time + timeframeSeconds > nowSeconds ? candles.slice(0, -1) : candles;
  }

  /** Index of the last candle whose open time is <= time, or -1. Candles must be sorted by time. */
  function lastIndexAtOrBefore(candles, time) {
    let low = 0;
    let high = candles.length - 1;
    let answer = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (candles[middle].time <= time) { answer = middle; low = middle + 1; } else { high = middle - 1; }
    }
    return answer;
  }

  APA.candles = {
    bodyTop, bodyBottom, bodySize, range, upperWick, lowerWick, isBullish, isBearish,
    isBullishEngulfing, isBearishEngulfing, isBullishPinBar, isBearishPinBar, isDoji, isInsideBar,
    averageRange, averageBody, resample, closedOnly, lastIndexAtOrBefore,
  };
})((globalThis.APA = globalThis.APA || {}));
