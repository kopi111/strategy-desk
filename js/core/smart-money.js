(function (APA) {
  'use strict';

  const { bodySize, range, isBullish, isBearish, averageRange, averageBody, resample, lastIndexAtOrBefore } = APA.candles;

  // Every concept the chart can draw and the alerts can watch. These names come from the two TikTok pictures.
  // "KRM" from the second picture is left out on purpose: no public source defines its rules.
  const CONCEPTS = [
    { id: 'bos', name: 'Break of structure', short: 'BOS', summary: 'A candle closes past the last swing, in the direction of the trend.' },
    { id: 'mss', name: 'Market structure shift', short: 'MSS', summary: 'A candle closes past the last swing, against the trend (also called CHoCH).' },
    { id: 'fvg', name: 'Fair value gap', short: 'FVG', summary: 'A gap between candle 1 and candle 3 of a fast move.' },
    { id: 'ob', name: 'Order block', short: 'OB', summary: 'The last opposite candle before the move that broke structure.' },
    { id: 'sweep', name: 'Liquidity sweep', short: 'Sweep', summary: 'A wick pokes past a swing, then the candle closes back inside.' },
    { id: 'ifvg', name: 'Inverse fair value gap', short: 'IFVG', summary: 'A fair value gap that price closed through, now facing the other way.' },
    { id: 'breaker', name: 'Breaker block', short: 'Breaker', summary: 'An order block that price closed through, now facing the other way.' },
    { id: 'ote', name: 'Optimal trade entry', short: 'OTE', summary: 'The 62% to 79% pullback of the move that broke structure.' },
    { id: 'sd', name: 'Supply and demand', short: 'S&D', summary: 'A small pause of 1 to 3 candles right before a strong candle.' },
    { id: 'sr', name: 'Support and resistance', short: 'S&R', summary: 'A price level where at least two swings turned.' },
    { id: 'breakout', name: 'Breakout', short: 'Breakout', summary: 'A close outside a tight 20-candle range.' },
    { id: 'crt', name: 'Candle range theory', short: 'CRT', summary: 'A higher-timeframe candle wicks past the last one and closes back inside its range.' },
    { id: 'silverBullet', name: 'Silver Bullet', short: 'Silver Bullet', summary: 'A fair value gap inside a New York time window, right after a sweep. 15m charts or lower.' },
    { id: 'powerOf3', name: 'Power of 3', short: 'Power of 3', summary: 'Price sweeps the Asia range, then closes back inside it. 1H charts or lower.' },
  ];

  // Tuning numbers. None come from an official rulebook, because these concepts have no single agreed definition.
  const DEFAULT_SWING_STRENGTH = 3;
  const MINIMUM_GAP_RANGES = 0.25;
  const MAX_ZONE_AGE_BARS = 500;
  const OTE_SHALLOW = 0.62;
  const OTE_DEEP = 0.79;
  const IMPULSE_BODY_FACTOR = 2;
  const IMPULSE_BODY_SHARE = 0.6;
  const BASE_BODY_FACTOR = 0.6;
  const MAX_BASE_CANDLES = 3;
  const LEVEL_TOLERANCE_RANGES = 0.25;
  const BREAKOUT_WINDOW_BARS = 20;
  const BREAKOUT_MAX_HEIGHT_RANGES = 3.5;
  const OPEN_SWINGS_KEPT = 8;
  const SILVER_BULLET_HOURS = [3, 10, 14];
  const SILVER_BULLET_MAX_SECONDS = 900;
  const SWEEP_MEMORY_BARS = 20;
  const POWER_OF_3_MAX_SECONDS = 3600;
  const ASIA_START_HOUR = 20;
  const MANIPULATION_END_HOUR = 11;
  const CRT_REFERENCE_SECONDS = { 60: 900, 300: 3600, 900: 14400, 1800: 14400, 3600: 86400, 14400: 86400 };
  const ZONES_DRAWN_PER_CONCEPT = 4;
  const STRUCTURE_EVENTS_DRAWN = 14;
  const OTHER_EVENTS_DRAWN = 6;

  const newYorkClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });

  /** The hour of the day in New York, with daylight saving handled by the browser. */
  function newYorkHour(epochSeconds) {
    return Number(newYorkClock.format(new Date(epochSeconds * 1000)));
  }

  /** Finds the concept's details from its id, for example 'ob'. */
  function concept(id) {
    const found = CONCEPTS.find((item) => item.id === id);
    if (!found) throw new Error(`Unknown concept "${id}"`);
    return found;
  }

  /** Turns 'buy' or 'sell' into the word a trader reads on screen. */
  function sideWord(direction) {
    return direction === 'buy' ? 'Bullish' : 'Bearish';
  }

  // ---------- zones: areas that stay on the chart until price closes through them ----------

  /** Builds a zone. The id uses the source candle's time, so it stays the same when new candles arrive. */
  function newZone(conceptId, direction, candles, startIndex, formedIndex, top, bottom, expiresIndex = null) {
    return {
      id: `${conceptId}:${direction}:${candles[startIndex].time}`,
      concept: conceptId, direction, top, bottom,
      startTime: candles[startIndex].time,
      formedIndex, expiresIndex,
      touchedIndex: null, brokenIndex: null, endIndex: null,
    };
  }

  /** Has this candle reached the zone? A buy zone sits below price, so its top is reached first. */
  function reachesZone(zone, candle) {
    return zone.direction === 'buy' ? candle.low <= zone.top : candle.high >= zone.bottom;
  }

  /** Did this candle close past the far side of the zone? That ends the zone. */
  function closesThroughZone(zone, candle) {
    return zone.direction === 'buy' ? candle.close < zone.bottom : candle.close > zone.top;
  }

  /** Walks forward from when a zone formed and records its first touch and how it ended. */
  function traceZone(zone, candles) {
    const lastIndex = Math.min(candles.length - 1, zone.formedIndex + MAX_ZONE_AGE_BARS);
    for (let index = zone.formedIndex + 1; index <= lastIndex; index++) {
      if (zone.expiresIndex !== null && index >= zone.expiresIndex) { zone.endIndex = index; return zone; }
      if (zone.touchedIndex === null && reachesZone(zone, candles[index])) zone.touchedIndex = index;
      if (closesThroughZone(zone, candles[index])) {
        zone.brokenIndex = index;
        zone.endIndex = index;
        return zone;
      }
    }
    // A zone that reached its age limit is finished, even though price never closed through it.
    if (lastIndex === zone.formedIndex + MAX_ZONE_AGE_BARS) zone.endIndex = lastIndex;
    return zone;
  }

  /** Finds fair value gaps: candle 1 and candle 3 of a fast move do not overlap. */
  function findFairValueGaps(candles) {
    const zones = [];
    for (let index = 2; index < candles.length; index++) {
      const first = candles[index - 2];
      const third = candles[index];
      const minimumGap = averageRange(candles, index) * MINIMUM_GAP_RANGES;
      if (third.low - first.high >= minimumGap) zones.push(newZone('fvg', 'buy', candles, index - 1, index, third.low, first.high));
      else if (first.low - third.high >= minimumGap) zones.push(newZone('fvg', 'sell', candles, index - 1, index, first.low, third.high));
    }
    return zones;
  }

  /** Finds where the move that broke structure began: the lowest low (or highest high) since the broken swing. */
  function legStartIndex(candles, breakEvent) {
    const buying = breakEvent.direction === 'buy';
    let bestIndex = breakEvent.swingIndex;
    for (let index = breakEvent.swingIndex; index <= breakEvent.index; index++) {
      const isBetter = buying ? candles[index].low < candles[bestIndex].low : candles[index].high > candles[bestIndex].high;
      if (isBetter) bestIndex = index;
    }
    return bestIndex;
  }

  /** Walks back from the start of the move to the last candle that went the opposite way. */
  function lastOppositeCandleIndex(candles, startIndex, direction) {
    const isOpposite = direction === 'buy' ? isBearish : isBullish;
    for (let index = startIndex; index >= Math.max(0, startIndex - MAX_BASE_CANDLES * 3); index--) {
      if (isOpposite(candles[index])) return index;
    }
    return -1;
  }

  /** Finds order blocks: one for each break of structure, built from the last opposite candle before the move. */
  function findOrderBlocks(candles, breakEvents) {
    const zones = new Map();
    for (const breakEvent of breakEvents) {
      const sourceIndex = lastOppositeCandleIndex(candles, legStartIndex(candles, breakEvent), breakEvent.direction);
      if (sourceIndex < 0) continue;
      const source = candles[sourceIndex];
      const zone = newZone('ob', breakEvent.direction, candles, sourceIndex, breakEvent.index, source.high, source.low);
      if (!zones.has(zone.id)) zones.set(zone.id, zone);
    }
    return [...zones.values()];
  }

  /** Finds the OTE pullback area of each structure break. The next break replaces it. */
  function findOptimalTradeEntries(candles, breakEvents) {
    return breakEvents.map((breakEvent, position) => {
      const buying = breakEvent.direction === 'buy';
      const startIndex = legStartIndex(candles, breakEvent);
      const legEnd = buying ? candles[breakEvent.index].high : candles[breakEvent.index].low;
      const legStart = buying ? candles[startIndex].low : candles[startIndex].high;
      const shallow = legEnd + (legStart - legEnd) * OTE_SHALLOW;
      const deep = legEnd + (legStart - legEnd) * OTE_DEEP;
      const nextBreak = breakEvents[position + 1];
      return newZone('ote', breakEvent.direction, candles, breakEvent.index, breakEvent.index,
        Math.max(shallow, deep), Math.min(shallow, deep), nextBreak ? nextBreak.index : null);
    });
  }

  /** Is this candle a strong move: a large body that makes up most of the candle? */
  function isImpulse(candles, index) {
    const candle = candles[index];
    const size = range(candle);
    return size > 0 && index > 0
      && bodySize(candle) >= averageBody(candles, index - 1) * IMPULSE_BODY_FACTOR
      && bodySize(candle) / size >= IMPULSE_BODY_SHARE;
  }

  /** Counts the small candles straight before a strong candle. That pause is the base of the zone. */
  function baseLength(candles, impulseIndex) {
    const smallBody = averageBody(candles, impulseIndex - 1) * BASE_BODY_FACTOR;
    let length = 0;
    while (length < MAX_BASE_CANDLES && impulseIndex - length - 1 >= 0 && bodySize(candles[impulseIndex - length - 1]) <= smallBody) length++;
    return length;
  }

  /** Finds supply and demand zones: a small pause and then a strong candle leaving it. */
  function findSupplyDemandZones(candles) {
    const zones = [];
    for (let index = 1; index < candles.length; index++) {
      if (!isImpulse(candles, index)) continue;
      const length = baseLength(candles, index);
      if (!length) continue;
      const base = candles.slice(index - length, index);
      const direction = isBullish(candles[index]) ? 'buy' : 'sell';
      zones.push(newZone('sd', direction, candles, index - length, index,
        Math.max(...base.map((candle) => candle.high)), Math.min(...base.map((candle) => candle.low))));
    }
    return zones;
  }

  /** Finds support and resistance: swings of one type that keep turning at about the same price. */
  function findLevels(candles, swings) {
    const zones = [];
    for (const type of ['high', 'low']) {
      const clusters = [];
      for (const swing of swings.filter((item) => item.type === type)) {
        const tolerance = averageRange(candles, swing.index) * LEVEL_TOLERANCE_RANGES;
        const cluster = clusters.find((item) => swing.extreme >= item.bottom - tolerance && swing.extreme <= item.top + tolerance);
        if (!cluster) { clusters.push({ top: swing.extreme + tolerance / 2, bottom: swing.extreme - tolerance / 2, startIndex: swing.index, hasZone: false }); continue; }
        cluster.top = Math.max(cluster.top, swing.extreme);
        cluster.bottom = Math.min(cluster.bottom, swing.extreme);
        // The second swing makes it a level. It is only known once that swing has been confirmed.
        if (cluster.hasZone || swing.confirmedIndex >= candles.length) continue;
        cluster.hasZone = true;
        zones.push(newZone('sr', type === 'high' ? 'sell' : 'buy', candles, cluster.startIndex, swing.confirmedIndex, cluster.top, cluster.bottom));
      }
    }
    return zones;
  }

  /** Makes the opposite zone that appears when price closes through a zone (IFVG and breaker block). */
  function invertBrokenZones(zones, conceptId, candles) {
    return zones.filter((zone) => zone.brokenIndex !== null).map((zone) => {
      const flipped = newZone(conceptId, zone.direction === 'buy' ? 'sell' : 'buy', candles, zone.brokenIndex, zone.brokenIndex, zone.top, zone.bottom);
      flipped.startTime = zone.startTime;
      return flipped;
    });
  }

  // ---------- events: things that happen on one candle ----------

  /** Builds an event. The id stays the same when new candles arrive, so one event can only alert once. */
  function newEvent(conceptId, direction, candles, index, price, extra = {}) {
    const name = concept(conceptId).name.toLowerCase();
    return {
      id: `${conceptId}:${direction}:${candles[index].time}`,
      concept: conceptId, direction, index, price,
      time: candles[index].time,
      message: `${sideWord(direction)} ${name}`,
      ...extra,
    };
  }

  /** Converts the desk's existing structure breaks into BOS and MSS events. */
  function structureBreakEvents(structure) {
    return structure.events.map((item) => newEvent(item.kind === 'CHOCH' ? 'mss' : 'bos', item.direction === 'up' ? 'buy' : 'sell',
      structure.candles, item.index, item.brokenSwing.extreme, { swingIndex: item.brokenSwing.index, swingTime: item.brokenSwing.time }));
  }

  /** Checks one side of the market for a sweep, and removes every swing this candle went past. */
  function sweepOfOpenSwings(openSwings, candle, buying) {
    const passed = openSwings.filter((swing) => (buying ? candle.low < swing.extreme : candle.high > swing.extreme));
    const swept = passed.filter((swing) => (buying ? candle.close > swing.extreme : candle.close < swing.extreme));
    const remaining = openSwings.filter((swing) => !passed.includes(swing));
    if (!swept.length) return { remaining, sweptSwing: null };
    const pickOutermost = (best, swing) => ((buying ? swing.extreme < best.extreme : swing.extreme > best.extreme) ? swing : best);
    return { remaining, sweptSwing: swept.reduce(pickOutermost) };
  }

  /** Finds liquidity sweeps. Sweeping a low points up (buy); sweeping a high points down (sell). */
  function findSweeps(candles, swings) {
    const events = [];
    const confirmed = [...swings].sort((first, second) => first.confirmedIndex - second.confirmedIndex);
    const open = { high: [], low: [] };
    let pointer = 0;
    for (let index = 0; index < candles.length; index++) {
      // Only swings that are already confirmed can be swept, so nothing here looks into the future.
      while (pointer < confirmed.length && confirmed[pointer].confirmedIndex <= index) {
        const swing = confirmed[pointer++];
        open[swing.type] = [...open[swing.type], swing].slice(-OPEN_SWINGS_KEPT);
      }
      for (const [type, direction] of [['high', 'sell'], ['low', 'buy']]) {
        const { remaining, sweptSwing } = sweepOfOpenSwings(open[type], candles[index], direction === 'buy');
        open[type] = remaining;
        if (sweptSwing) events.push(newEvent('sweep', direction, candles, index, sweptSwing.extreme, { swingTime: sweptSwing.time }));
      }
    }
    return events;
  }

  /** Finds breakouts: the candle closes outside a tight range, with no other breakout during that range. */
  function findBreakouts(candles) {
    const events = [];
    let lastBreakoutIndex = -Infinity;
    for (let index = BREAKOUT_WINDOW_BARS; index < candles.length; index++) {
      if (index - lastBreakoutIndex < BREAKOUT_WINDOW_BARS) continue;
      const window = candles.slice(index - BREAKOUT_WINDOW_BARS, index);
      const top = Math.max(...window.map((candle) => candle.high));
      const bottom = Math.min(...window.map((candle) => candle.low));
      if (top - bottom > averageRange(candles, index - 1) * BREAKOUT_MAX_HEIGHT_RANGES) continue;
      const direction = candles[index].close > top ? 'buy' : candles[index].close < bottom ? 'sell' : null;
      if (!direction) continue;
      lastBreakoutIndex = index;
      const box = { top, bottom, startTime: window[0].time };
      events.push(newEvent('breakout', direction, candles, index, direction === 'buy' ? top : bottom, { box }));
    }
    return events;
  }

  /** Which way a higher-timeframe candle points after wicking past the one before it. Null means no setup. */
  function candleRangeDirection(reference, current) {
    const wickedAbove = current.high > reference.high;
    const wickedBelow = current.low < reference.low;
    const closedInside = current.close < reference.high && current.close > reference.low;
    if (!closedInside || wickedAbove === wickedBelow) return null;
    return wickedAbove ? 'sell' : 'buy';
  }

  /** Finds CRT setups on the next timeframe up, using only higher-timeframe candles that have fully closed. */
  function findCandleRangeSetups(candles, seconds) {
    const referenceSeconds = CRT_REFERENCE_SECONDS[seconds];
    if (!referenceSeconds || !candles.length) return [];
    const lastClose = candles[candles.length - 1].time + seconds;
    // The first bucket may be missing candles, and the last may still be forming, so neither is used.
    const buckets = resample(candles, referenceSeconds).slice(1).filter((bucket) => bucket.time + referenceSeconds <= lastClose);
    const events = [];
    for (let position = 1; position < buckets.length; position++) {
      const direction = candleRangeDirection(buckets[position - 1], buckets[position]);
      if (!direction) continue;
      // The signal belongs to the last candle that opened inside this bucket. Working it out any other way could fire
      // one candle early when candle times do not line up with the bucket, and use a close that has not happened yet.
      const index = lastIndexAtOrBefore(candles, buckets[position].time + referenceSeconds - 1);
      const reference = buckets[position - 1];
      const box = { top: reference.high, bottom: reference.low, startTime: reference.time };
      events.push(newEvent('crt', direction, candles, index, direction === 'buy' ? reference.low : reference.high, { box }));
    }
    return events;
  }

  /** Finds Silver Bullet setups: the first gap in a window that agrees with a recent sweep. */
  function findSilverBullets(candles, gaps, sweeps, seconds) {
    if (seconds > SILVER_BULLET_MAX_SECONDS) return [];
    const usedWindows = new Set();
    const events = [];
    for (const gap of gaps) {
      const time = candles[gap.formedIndex].time;
      const hour = newYorkHour(time);
      const windowKey = `${Math.floor(time / 3600)}:${gap.direction}`;
      if (!SILVER_BULLET_HOURS.includes(hour) || usedWindows.has(windowKey)) continue;
      const hasSweep = sweeps.some((sweep) => sweep.direction === gap.direction
        && sweep.index < gap.formedIndex && gap.formedIndex - sweep.index <= SWEEP_MEMORY_BARS);
      if (!hasSweep) continue;
      usedWindows.add(windowKey);
      const box = { top: gap.top, bottom: gap.bottom, startTime: gap.startTime };
      events.push(newEvent('silverBullet', gap.direction, candles, gap.formedIndex, gap.direction === 'buy' ? gap.top : gap.bottom, { box }));
    }
    return events;
  }

  /** Finds Power of 3 setups: price wicks past the evening Asia range and closes back inside it. */
  function findPowerOfThree(candles, seconds) {
    if (seconds > POWER_OF_3_MAX_SECONDS) return [];
    const events = [];
    let session = null;
    for (let index = 0; index < candles.length; index++) {
      const candle = candles[index];
      const hour = newYorkHour(candle.time);
      if (hour >= ASIA_START_HOUR) {
        // Each evening starts a new Asia range, and each later Asia candle widens it.
        if (!session || session.isFinished) session = { top: candle.high, bottom: candle.low, startTime: candle.time, isFinished: false };
        session.top = Math.max(session.top, candle.high);
        session.bottom = Math.min(session.bottom, candle.low);
        continue;
      }
      if (!session || session.isFinished) continue;
      if (hour > MANIPULATION_END_HOUR) { session.isFinished = true; continue; }
      const direction = candleRangeDirection({ high: session.top, low: session.bottom }, candle);
      if (!direction) continue;
      session.isFinished = true;
      const box = { top: session.top, bottom: session.bottom, startTime: session.startTime };
      events.push(newEvent('powerOf3', direction, candles, index, direction === 'buy' ? session.bottom : session.top, { box }));
    }
    return events;
  }

  /** Writes the alert line for a zone price has just reached. */
  function touchMessage(zone) {
    const side = sideWord(zone.direction).toLowerCase();
    if (zone.concept === 'sr') return `Price reached ${zone.direction === 'buy' ? 'support' : 'resistance'}`;
    if (zone.concept === 'sd') return `Price reached a ${zone.direction === 'buy' ? 'demand' : 'supply'} zone`;
    return `Price reached a ${side} ${concept(zone.concept).name.toLowerCase()}`;
  }

  /** Turns a zone's first touch into an event. The live check and the closed-candle check share one id. */
  function touchEvent(zone, index, time) {
    return {
      id: `${zone.id}:touch`, concept: zone.concept, direction: zone.direction, index, time,
      price: zone.direction === 'buy' ? zone.top : zone.bottom, message: touchMessage(zone),
    };
  }

  /**
   * Runs every detector over CLOSED candles and returns all zones and events.
   * Each one uses only candles up to its own candle, so later candles can never change what already happened.
   */
  function analyze(candles, { timeframeSeconds, swingStrength = DEFAULT_SWING_STRENGTH }) {
    const structure = APA.structure.analyze(candles, swingStrength);
    const breaks = structureBreakEvents(structure);
    const sweeps = findSweeps(candles, structure.swings);

    // Trace the first zones before flipping them, because IFVGs and breakers come from how those zones ended.
    const gaps = findFairValueGaps(candles).map((zone) => traceZone(zone, candles));
    const orderBlocks = findOrderBlocks(candles, breaks).map((zone) => traceZone(zone, candles));
    const otherZones = [
      ...invertBrokenZones(gaps, 'ifvg', candles),
      ...invertBrokenZones(orderBlocks, 'breaker', candles),
      ...findOptimalTradeEntries(candles, breaks),
      ...findSupplyDemandZones(candles),
      ...findLevels(candles, structure.swings),
    ].map((zone) => traceZone(zone, candles));
    const zones = [...gaps, ...orderBlocks, ...otherZones];

    const touches = zones.filter((zone) => zone.touchedIndex !== null)
      .map((zone) => touchEvent(zone, zone.touchedIndex, candles[zone.touchedIndex].time));
    const events = [
      ...breaks, ...sweeps, ...touches,
      ...findBreakouts(candles),
      ...findCandleRangeSetups(candles, timeframeSeconds),
      ...findSilverBullets(candles, gaps, sweeps, timeframeSeconds),
      ...findPowerOfThree(candles, timeframeSeconds),
    ].sort((first, second) => first.time - second.time);

    const lastIndex = candles.length - 1;
    return { candles, zones, events, trend: lastIndex >= 0 ? structure.trendAt[lastIndex] : 'none' };
  }

  /** Zones the forming candle has reached for the first time. This lets alerts fire before the candle closes. */
  function liveTouches(analysis, formingCandle) {
    return analysis.zones
      .filter((zone) => zone.endIndex === null && zone.touchedIndex === null && reachesZone(zone, formingCandle))
      .map((zone) => touchEvent(zone, analysis.candles.length, formingCandle.time));
  }

  /** The zones still in force, closest to the current price first, limited per concept to keep the chart readable. */
  function nearestActiveZones(analysis, enabled) {
    if (!analysis.candles.length) return [];
    const price = analysis.candles[analysis.candles.length - 1].close;
    const distance = (zone) => Math.abs((zone.top + zone.bottom) / 2 - price);
    return CONCEPTS.filter((item) => enabled[item.id]).flatMap((item) => analysis.zones
      .filter((zone) => zone.concept === item.id && zone.endIndex === null)
      .sort((first, second) => distance(first) - distance(second))
      .slice(0, ZONES_DRAWN_PER_CONCEPT));
  }

  /** Turns the analysis into simple drawing instructions: boxes, structure lines and tags. */
  function drawingsFor(analysis, enabled) {
    const boxes = nearestActiveZones(analysis, enabled).map((zone) => ({
      type: 'box', concept: zone.concept, direction: zone.direction, top: zone.top, bottom: zone.bottom,
      startTime: zone.startTime, endTime: null, label: concept(zone.concept).short, isUsed: zone.touchedIndex !== null,
    }));
    const events = analysis.events.filter((event) => enabled[event.concept]);
    const lines = events.filter((event) => event.concept === 'bos' || event.concept === 'mss').slice(-STRUCTURE_EVENTS_DRAWN).map((event) => ({
      type: 'line', concept: event.concept, direction: event.direction, price: event.price,
      startTime: event.swingTime, endTime: event.time, label: concept(event.concept).short,
    }));
    const tags = events.filter((event) => event.concept === 'sweep').slice(-OTHER_EVENTS_DRAWN).map((event) => ({
      type: 'tag', concept: event.concept, direction: event.direction, price: event.price,
      startTime: event.swingTime, endTime: event.time, label: concept(event.concept).short,
    }));
    const eventBoxes = events.filter((event) => event.box).slice(-OTHER_EVENTS_DRAWN).map((event) => ({
      type: 'box', concept: event.concept, direction: event.direction, top: event.box.top, bottom: event.box.bottom,
      startTime: event.box.startTime, endTime: event.time, label: concept(event.concept).short, isUsed: false,
    }));
    return [...boxes, ...eventBoxes, ...lines, ...tags];
  }

  APA.smartMoney = { concepts: CONCEPTS, concept, analyze, liveTouches, drawingsFor, newYorkHour };
})((globalThis.APA = globalThis.APA || {}));
