(function (APA) {
  'use strict';

  const { bodyTop, bodyBottom } = APA.candles;

  /**
   * Swing points on candle bodies (the "line chart" view both videos use). A swing is only known once
   * `strength` further candles have closed, recorded as confirmedIndex, so nothing downstream sees the future.
   */
  function findSwings(candles, strength) {
    const swings = [];
    for (let index = strength; index < candles.length - strength; index++) {
      if (isPivot(candles, index, strength, bodyTop, 1)) swings.push(swing('high', candles, index, strength));
      else if (isPivot(candles, index, strength, bodyBottom, -1)) swings.push(swing('low', candles, index, strength));
    }
    return swings;
  }

  function isPivot(candles, index, strength, measure, sign) {
    const value = measure(candles[index]) * sign;
    for (let offset = 1; offset <= strength; offset++) {
      if (measure(candles[index - offset]) * sign >= value) return false;
      if (measure(candles[index + offset]) * sign > value) return false;
    }
    return true;
  }

  function swing(type, candles, index, strength) {
    const candle = candles[index];
    return {
      type,
      index,
      time: candle.time,
      level: type === 'high' ? bodyTop(candle) : bodyBottom(candle),
      extreme: type === 'high' ? candle.high : candle.low,
      confirmedIndex: index + strength,
    };
  }

  /**
   * Walks candles in order and records every break of structure. A break needs a candle CLOSE beyond the
   * swing's wick (V1 2:26:13, V2 12:29). The first break against the running trend is a change of character.
   */
  function analyze(candles, strength) {
    const swings = findSwings(candles, strength);
    const events = [];
    const trendAt = new Array(candles.length);
    const brokenSwings = new Set();
    let trend = 'none';
    let pointer = 0;
    let activeHigh = null;
    let activeLow = null;

    for (let index = 0; index < candles.length; index++) {
      while (pointer < swings.length && swings[pointer].confirmedIndex <= index) {
        const confirmed = swings[pointer++];
        if (confirmed.type === 'high') activeHigh = confirmed; else activeLow = confirmed;
      }
      const close = candles[index].close;
      if (activeHigh && !brokenSwings.has(activeHigh) && close > activeHigh.extreme) {
        events.push(breakEvent(trend, 'up', index, activeHigh));
        brokenSwings.add(activeHigh);
        trend = 'up';
      } else if (activeLow && !brokenSwings.has(activeLow) && close < activeLow.extreme) {
        events.push(breakEvent(trend, 'down', index, activeLow));
        brokenSwings.add(activeLow);
        trend = 'down';
      }
      trendAt[index] = trend;
    }
    return { candles, swings, events, trendAt, strength };
  }

  function breakEvent(trendBefore, direction, index, brokenSwing) {
    const opposite = direction === 'up' ? 'down' : 'up';
    return { kind: trendBefore === opposite ? 'CHOCH' : 'BOS', direction, index, brokenSwing, trendBefore };
  }

  /** The last `count` swings of a type that were confirmed by `index` and sit before `beforeIndex`. */
  function lastConfirmedSwings(structure, type, index, count, beforeIndex = index) {
    const found = [];
    for (let position = structure.swings.length - 1; position >= 0 && found.length < count; position--) {
      const candidate = structure.swings[position];
      if (candidate.type === type && candidate.confirmedIndex <= index && candidate.index < beforeIndex) {
        found.unshift(candidate);
      }
    }
    return found;
  }

  APA.structure = { findSwings, analyze, lastConfirmedSwings };
})((globalThis.APA = globalThis.APA || {}));
