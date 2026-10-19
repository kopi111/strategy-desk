(function (APA) {
  'use strict';

  const { averageRange, averageBody, isBullish, isBearish } = APA.candles;
  const { lastConfirmedSwings } = APA.structure;

  // Order matters: when two models point at the same candle, the first one listed names the zone.
  const MODELS = [
    { id: 'qmInvalidation', short: 'QM', name: 'QM / Invalidation', video: 'V1 1:58:21 · V2 2:04', role: 'reversal',
      summary: 'After the first change of character, price returns to the left shoulder (the second-to-last high or low).' },
    { id: 'invalidationX', short: 'Inv X', name: 'Invalidation X', video: 'V2 32:18', role: 'reversal',
      summary: 'The trend fails to make a new extreme, then breaks. The failed swing becomes the zone.' },
    { id: 'newInvalidation', short: 'New Inv', name: 'New invalidation', video: 'V2 14:00', role: 'reversal',
      summary: 'Price never reached the invalidation, formed a new swing and broke again. Focus moves to that swing.' },
    { id: 'aFormation', short: 'A', name: 'Resistance A formation', video: 'V1 41:37', role: 'continuation',
      summary: 'Price breaks down from a peak. The body of the peak (the tip of the A) becomes resistance.' },
    { id: 'vFormation', short: 'V', name: 'Support V formation', video: 'V1 1:07:30', role: 'continuation',
      summary: 'Price breaks up from a low. The body of that low (the bottom of the V) becomes support.' },
    { id: 'ocl', short: 'OCL', name: 'OCL (open-close level)', video: 'V1 2:07', role: 'continuation',
      summary: 'Two impulsive same-colour candles. The line where one closes and the next opens, closest to the break.' },
    { id: 'sbr', short: 'SBR', name: 'SBR (support → resistance)', video: 'V1 1:28:13', role: 'continuation',
      summary: 'A support that held more than once is broken by a close, then retested from below.' },
    { id: 'rbs', short: 'RBS', name: 'RBS (resistance → support)', video: 'V1 1:47:55', role: 'continuation',
      summary: 'A resistance that held more than once is broken by a close, then retested from above.' },
  ];

  function model(id) {
    const found = MODELS.find((entry) => entry.id === id);
    if (!found) throw new Error(`Unknown model "${id}"`);
    return found;
  }

  /** Every zone the enabled models produce on the structure timeframe, in the order they became known. */
  function build(structure, timeframeSeconds, strategy) {
    const context = { structure, candles: structure.candles, timeframeSeconds, strategy };
    const zonesByKey = new Map();
    const reversalZones = [];

    for (const event of structure.events) {
      const created = [
        ...reversalAtChangeOfCharacter(context, event),
        ...newInvalidationAfterBreak(context, event, reversalZones),
        ...originOfBreak(context, event),
        ...openCloseLevel(context, event),
        ...brokenLevel(context, event),
      ];
      for (const zone of created) {
        if (!strategy.models[zone.model]) continue;
        if (model(zone.model).role === 'reversal') reversalZones.push(zone);
        addOrMerge(zonesByKey, zone);
      }
    }
    return [...zonesByKey.values()].sort((first, second) => first.createdIndex - second.createdIndex);
  }

  function addOrMerge(zonesByKey, zone) {
    const key = `${zone.direction}:${zone.sourceIndex}`;
    const existing = zonesByKey.get(key);
    if (!existing) { zonesByKey.set(key, zone); return; }
    const existingRank = MODELS.findIndex((entry) => entry.id === existing.model);
    const newRank = MODELS.findIndex((entry) => entry.id === zone.model);
    if (newRank < existingRank && zone.createdIndex === existing.createdIndex) {
      zone.alsoMatches = [existing.model, ...existing.alsoMatches];
      zonesByKey.set(key, zone);
    } else if (!existing.alsoMatches.includes(zone.model) && existing.model !== zone.model) {
      existing.alsoMatches.push(zone.model);
    }
  }

  function makeZone(context, modelId, direction, level, sourceIndex, event, explanation) {
    const { candles, timeframeSeconds } = context;
    return {
      id: `${modelId}:${direction}:${candles[sourceIndex].time}`,
      model: modelId,
      direction,
      level,
      sourceIndex,
      sourceTime: candles[sourceIndex].time,
      createdIndex: event.index,
      createdTime: candles[event.index].time,
      availableTime: candles[event.index].time + timeframeSeconds,
      eventKind: event.kind,
      averageRange: averageRange(candles, event.index),
      explanation,
      alsoMatches: [],
    };
  }

  const sideOf = (event) => (event.direction === 'down' ? 'sell' : 'buy');
  const swingTypeFor = (direction) => (direction === 'sell' ? 'high' : 'low');

  // QM (V1) and Invalidation (V2) are the same level: the second-to-last swing before the change of character.
  // If the last swing failed to beat the one before it, V2 calls the failed swing an Invalidation X.
  function reversalAtChangeOfCharacter(context, event) {
    if (event.kind !== 'CHOCH') return [];
    const direction = sideOf(event);
    const [previous, last] = lastConfirmedSwings(context.structure, swingTypeFor(direction), event.index, 2);
    if (!previous || !last) return [];
    const madeNewExtreme = direction === 'sell' ? last.level > previous.level : last.level < previous.level;
    const word = direction === 'sell' ? 'high' : 'low';
    if (madeNewExtreme) {
      return [makeZone(context, 'qmInvalidation', direction, previous.level, previous.index, event,
        `Change of character ${event.direction}. Left shoulder = second-to-last ${word} (body).`)];
    }
    return [makeZone(context, 'invalidationX', direction, last.level, last.index, event,
      `Trend failed to make a new ${word}, then broke. The failed ${word} (body) is the zone.`)];
  }

  function newInvalidationAfterBreak(context, event, reversalZones) {
    if (event.kind !== 'BOS') return [];
    const direction = sideOf(event);
    const parent = [...reversalZones].reverse()
      .find((zone) => zone.direction === direction && zone.createdIndex < event.index);
    if (!parent || wasReached(context.candles, parent, event.index)) return [];
    const [candidate] = lastConfirmedSwings(context.structure, swingTypeFor(direction), event.index, 1);
    if (!candidate || candidate.index <= parent.createdIndex) return [];
    const isInside = direction === 'sell' ? candidate.level < parent.level : candidate.level > parent.level;
    if (!isInside) return [];
    return [makeZone(context, 'newInvalidation', direction, candidate.level, candidate.index, event,
      `Price never reached the ${model(parent.model).name} and broke again. The new swing takes focus; the old level stays valid.`)];
  }

  function wasReached(candles, zone, untilIndex) {
    for (let index = zone.createdIndex + 1; index <= untilIndex; index++) {
      const reached = zone.direction === 'sell' ? candles[index].high >= zone.level : candles[index].low <= zone.level;
      if (reached) return true;
    }
    return false;
  }

  function originOfBreak(context, event) {
    const direction = sideOf(event);
    const [origin] = lastConfirmedSwings(context.structure, swingTypeFor(direction), event.index, 1);
    if (!origin) return [];
    if (direction === 'sell') {
      return [makeZone(context, 'aFormation', 'sell', origin.level, origin.index, event,
        'Price broke down from this peak. The tip of the A (body) is resistance.')];
    }
    return [makeZone(context, 'vFormation', 'buy', origin.level, origin.index, event,
      'Price broke up from this low. The bottom of the V (body) is support.')];
  }

  function openCloseLevel(context, event) {
    const { candles, strategy, structure } = context;
    const direction = sideOf(event);
    const [legStart] = lastConfirmedSwings(structure, swingTypeFor(direction), event.index, 1);
    const firstIndex = legStart ? legStart.index : Math.max(0, event.index - 20);
    const sameColour = direction === 'buy' ? isBullish : isBearish;

    for (let index = event.index - 1; index >= firstIndex; index--) {
      const first = candles[index];
      const second = candles[index + 1];
      if (!sameColour(first) || !sameColour(second)) continue;
      const minimumBody = averageBody(candles, index) * strategy.impulseBodyFactor;
      if (Math.abs(first.close - first.open) < minimumBody || Math.abs(second.close - second.open) < minimumBody) continue;
      const level = (first.close + second.open) / 2;
      if (!isFresh(candles, level, direction, index + 2, event.index)) continue;
      return [makeZone(context, 'ocl', direction, level, index, event,
        `${direction === 'buy' ? 'Bullish' : 'Bearish'} OCL closest to the break: candle 1 closes where candle 2 opens.`)];
    }
    return [];
  }

  function isFresh(candles, level, direction, fromIndex, toIndex) {
    for (let index = fromIndex; index <= toIndex; index++) {
      const touched = direction === 'buy' ? candles[index].low <= level : candles[index].high >= level;
      if (touched) return false;
    }
    return true;
  }

  // SBR / RBS: the swing that just broke must have held as a level at least minLevelTouches times.
  function brokenLevel(context, event) {
    const { structure, candles, strategy } = context;
    const broken = event.brokenSwing;
    const tolerance = averageRange(candles, event.index) * strategy.levelToleranceRanges;
    const touches = structure.swings.filter((candidate) => candidate.type === broken.type
      && candidate.index <= broken.index
      && candidate.confirmedIndex <= event.index
      && Math.abs(candidate.level - broken.level) <= tolerance).length;
    if (touches < strategy.minLevelTouches) return [];
    if (event.direction === 'down') {
      return [makeZone(context, 'sbr', 'sell', broken.level, broken.index, event,
        `Support held ${touches}× then closed below. Old support should now act as resistance.`)];
    }
    return [makeZone(context, 'rbs', 'buy', broken.level, broken.index, event,
      `Resistance held ${touches}× then closed above. Old resistance should now act as support.`)];
  }

  APA.zones = { models: MODELS, model, build };
})((globalThis.APA = globalThis.APA || {}));
