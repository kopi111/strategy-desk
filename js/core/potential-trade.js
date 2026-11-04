(function (APA) {
  'use strict';

  // These numbers are the rule. The backtest in research/potential-trade runs this same code, so changing one means testing again.
  const ZONE_CONCEPTS = ['ob', 'fvg'];
  const CONFIRMATION_CONCEPTS = ['mss', 'sweep'];
  const CONFIRMATION_CANDLES = 16;
  const AVERAGE_RANGE_CANDLES = 14;
  const STOP_BUFFER_RANGES = 0.5;
  const TARGET_LOOKBACK_CANDLES = 96;
  const MAXIMUM_WAIT_RANGES = 1;
  const MINIMUM_REWARD_TO_RISK = 1;

  // Candles fetched per timeframe. The backtest looks at the same amount of history.
  const CANDLES_NEEDED = { entry: 500, hour: 300, fourHour: 150 };
  const ENTRY_SECONDS = 900;
  const HOUR_SECONDS = 3600;
  const FOUR_HOUR_SECONDS = 14400;
  const GOLD_TREND = { symbol: 'frxXAUUSD', seconds: 2700, fast: 20, slow: 100, stopRanges: 2, candlesNeeded: 1500 };

  /** The answer when there is no trade. It has the same fields to check as a real plan, so callers never handle null. */
  const noTrade = (reason) => ({ status: 'none', side: 'none', reason });

  /** A side only exists when the 1H and 4H trends agree. */
  function sideFromTrends(hourTrend, fourHourTrend) {
    if (hourTrend !== fourHourTrend) return 'none';
    return { up: 'buy', down: 'sell' }[hourTrend] || 'none';
  }

  /** Finds the nearest order block or fair value gap still in force, on the pullback side of the price. */
  function nearestZone(zones, side, price) {
    const buying = side === 'buy';
    const candidates = zones.filter((zone) => zone.endIndex === null && zone.direction === side
      && ZONE_CONCEPTS.includes(zone.concept) && (buying ? zone.bottom <= price : zone.top >= price));
    candidates.sort((first, second) => (buying ? second.top - first.top : first.bottom - second.bottom));
    return candidates[0];
  }

  /** Newest sweep or market structure shift in the trade's direction, within the last few closed candles. */
  function latestConfirmation(analysis, side) {
    const newestTime = analysis.candles[analysis.candles.length - 1].time;
    const oldestAllowed = newestTime - CONFIRMATION_CANDLES * ENTRY_SECONDS;
    return analysis.events.filter((event) => event.direction === side
      && CONFIRMATION_CONCEPTS.includes(event.concept) && event.time >= oldestAllowed).pop();
  }

  /** The high or low of the last day of 15-minute candles, which is the take profit. */
  function targetPrice(candles, side) {
    const recent = candles.slice(-TARGET_LOOKBACK_CANDLES);
    return side === 'buy' ? Math.max(...recent.map((candle) => candle.high)) : Math.min(...recent.map((candle) => candle.low));
  }

  /** Works out entry, stop and take profit around a zone. A price inside the zone is ready; just outside it, the plan waits. */
  function levelsFor(zone, side, price, averageRange, target) {
    const buying = side === 'buy';
    const entry = buying ? Math.min(price, zone.top) : Math.max(price, zone.bottom);
    const stop = buying ? zone.bottom - averageRange * STOP_BUFFER_RANGES : zone.top + averageRange * STOP_BUFFER_RANGES;
    const risk = Math.abs(entry - stop);
    const reward = buying ? target - entry : entry - target;
    return { entry, stop, target, rewardToRisk: reward / risk, breakEvenWinRate: risk / (risk + reward), isAtEntry: entry === price, waitRanges: Math.abs(price - entry) / averageRange };
  }

  /** Decides the plan from an analysis of closed 15-minute candles, the two higher trends and the latest price. */
  function planFrom(analysis, hourTrend, fourHourTrend, price) {
    const side = sideFromTrends(hourTrend, fourHourTrend);
    if (side === 'none') return noTrade('The 1H and 4H trends disagree.');
    const zone = nearestZone(analysis.zones, side, price);
    if (!zone) return noTrade(`The trend says ${side}, but no order block or gap is in force.`);
    const confirmation = latestConfirmation(analysis, side);
    if (!confirmation) return noTrade(`The trend says ${side}, but there is no recent sweep or MSS.`);
    const { candles } = analysis;
    const averageRange = APA.candles.averageRange(candles, candles.length - 1, AVERAGE_RANGE_CANDLES);
    const levels = levelsFor(zone, side, price, averageRange, targetPrice(candles, side));
    if (levels.waitRanges > MAXIMUM_WAIT_RANGES) return noTrade(`The ${side} zone is too far from the price.`);
    if (!(levels.rewardToRisk >= MINIMUM_REWARD_TO_RISK)) return noTrade(`The ${side} setup pays less than it risks.`);
    return { status: levels.isAtEntry ? 'ready' : 'waiting', side, ...levels, zone, confirmation };
  }

  /** Fetches what one market needs and returns its plan. Only closed candles are analysed, never the forming one. */
  async function forMarket(market, symbol, nowSeconds = Math.floor(Date.now() / 1000)) {
    const closed = async (seconds, count) => APA.candles.closedOnly(await market.chartCandles(symbol, seconds, count), seconds, nowSeconds);
    const raw = await market.chartCandles(symbol, ENTRY_SECONDS, CANDLES_NEEDED.entry);
    const entryCandles = APA.candles.closedOnly(raw, ENTRY_SECONDS, nowSeconds);
    if (!entryCandles.length) return noTrade('Deriv sent no candles.');
    const trendOf = (candles, seconds) => APA.smartMoney.analyze(candles, { timeframeSeconds: seconds }).trend;
    const hourTrend = trendOf(await closed(HOUR_SECONDS, CANDLES_NEEDED.hour), HOUR_SECONDS);
    const fourHourTrend = trendOf(await closed(FOUR_HOUR_SECONDS, CANDLES_NEEDED.fourHour), FOUR_HOUR_SECONDS);
    const analysis = APA.smartMoney.analyze(entryCandles, { timeframeSeconds: ENTRY_SECONDS });
    return planFrom(analysis, hourTrend, fourHourTrend, raw[raw.length - 1].close);
  }

  /** Exponential moving average of a list of values, one value out per value in. */
  function movingAverage(values, length) {
    const weight = 2 / (length + 1);
    let current = values[0];
    return values.map((value) => { current = value * weight + current * (1 - weight); return current; });
  }

  /** Finds the first candle of the current run where the fast average has stayed on the same side of the slow one. */
  function crossIndex(fast, slow) {
    const isAbove = (index) => fast[index] > slow[index];
    let index = fast.length - 1;
    while (index > 0 && isAbove(index - 1) === isAbove(fast.length - 1)) index--;
    return index;
  }

  /**
   * The gold rule that held up in testing (research/mtf_triple_screen): 45-minute candles, EMA 20 and 100, stop 2 average
   * ranges from the entry, close when the averages cross back. It has no fixed take profit, so none is given.
   */
  function goldTrendState(fifteenMinuteCandles) {
    const candles = APA.candles.resample(fifteenMinuteCandles, GOLD_TREND.seconds).slice(1);
    if (candles.length <= GOLD_TREND.slow) return noTrade('Not enough gold candles yet.');
    const closes = candles.map((candle) => candle.close);
    const fast = movingAverage(closes, GOLD_TREND.fast);
    const slow = movingAverage(closes, GOLD_TREND.slow);
    const start = crossIndex(fast, slow);
    const buying = fast[fast.length - 1] > slow[slow.length - 1];
    const entry = closes[start];
    const distance = APA.candles.averageRange(candles, start, AVERAGE_RANGE_CANDLES) * GOLD_TREND.stopRanges;
    const stop = buying ? entry - distance : entry + distance;
    const later = candles.slice(start + 1);
    const wasStopped = later.some((candle) => (buying ? candle.low <= stop : candle.high >= stop));
    return { status: wasStopped ? 'stopped' : 'open', side: buying ? 'buy' : 'sell', entry, stop, since: candles[start].time, candlesAgo: later.length };
  }

  /** Fetches gold candles and returns where the trend rule stands. */
  async function goldTrend(market, nowSeconds = Math.floor(Date.now() / 1000)) {
    const candles = await market.chartCandles(GOLD_TREND.symbol, ENTRY_SECONDS, GOLD_TREND.candlesNeeded);
    return goldTrendState(APA.candles.closedOnly(candles, ENTRY_SECONDS, nowSeconds));
  }

  APA.potentialTrade = { planFrom, forMarket, sideFromTrends, goldTrendState, goldTrend, CANDLES_NEEDED, ENTRY_SECONDS, HOUR_SECONDS, FOUR_HOUR_SECONDS };
})((globalThis.APA = globalThis.APA || {}));
