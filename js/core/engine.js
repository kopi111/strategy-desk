(function (APA) {
  'use strict';

  const C = APA.candles;
  const LIVE_STATUSES = new Set(['waiting', 'tapped']);
  const CHOCH_LOOKBACK_BARS = 30;
  const TARGET_SWINGS_CONSIDERED = 40;

  /**
   * Replays the strategy candle by candle on the entry timeframe. Zones come from the structure timeframe and
   * only appear once their break candle has closed; targets come from the bias timeframe. The same replay
   * drives the live signal (its last candle) and the backtest (every trade it opened).
   */
  class Simulation {
    constructor(input) {
      this.instrument = input.instrument;
      this.strategy = input.strategy;
      this.costs = input.costs || { slippagePrice: 0, commissionPerLot: 0 };
      this.entry = input.candleSets.entry;
      this.structureCandles = input.candleSets.structure;
      this.biasCandles = input.candleSets.bias;
      this.seconds = input.timeframeSeconds;

      this.structure = APA.structure.analyze(this.structureCandles, this.strategy.swingStrength);
      this.bias = APA.structure.analyze(this.biasCandles, this.strategy.swingStrength);
      this.entrySwings = APA.structure.findSwings(this.entry, this.strategy.entrySwingStrength);
      this.zones = APA.zones.build(this.structure, this.seconds.structure, this.strategy);
      this.liquiditySwings = this.withConfirmTime(this.structure, this.seconds.structure);
      this.targetSwings = this.withConfirmTime(this.bias, this.seconds.bias);

      this.states = [];
      this.liveStates = [];
      this.trades = [];
      this.openTrade = null;
      this.nextZone = 0;
    }

    withConfirmTime(analysis, seconds) {
      return analysis.swings.map((swing) => ({
        ...swing, confirmTime: analysis.candles[swing.confirmedIndex].time + seconds,
      }));
    }

    run() {
      for (let index = 1; index < this.entry.length; index++) this.step(index);
      return this;
    }

    step(index) {
      const candle = this.entry[index];
      this.activateZones(candle.time);
      if (this.openTrade && this.openTrade.entryIndex < index) this.manageTrade(this.openTrade, index);
      for (const state of this.liveStates) this.advanceZone(state, index);
      this.liveStates = this.liveStates.filter((state) => LIVE_STATUSES.has(state.status));
    }

    // ---------- zone lifecycle ----------

    activateZones(time) {
      while (this.nextZone < this.zones.length && this.zones[this.nextZone].availableTime <= time) {
        const state = this.newState(this.zones[this.nextZone++]);
        this.states.push(state);
        if (state.status === 'waiting') this.liveStates.push(state);
      }
    }

    newState(zone) {
      const state = { zone, status: 'waiting', reason: 'Waiting for price to return to the level.', sweptSwing: null,
        tapIndex: null, extremeSinceTap: null, confirmation: null, trade: null };
      if (zone.availableTime < this.entry[0].time && this.reachedBeforeEntryData(zone)) {
        this.finish(state, 'stale', 'Price already returned to this level before the loaded entry candles begin.');
      }
      return state;
    }

    reachedBeforeEntryData(zone) {
      const lastIndex = C.lastIndexAtOrBefore(this.structureCandles, this.entry[0].time - this.seconds.structure);
      const tolerance = this.tapTolerance(zone);
      for (let index = zone.createdIndex + 1; index <= lastIndex; index++) {
        if (this.touches(zone, this.structureCandles[index], tolerance)) return true;
      }
      return false;
    }

    advanceZone(state, index) {
      const { zone } = state;
      const candle = this.entry[index];
      const closeTime = candle.time + this.seconds.entry;
      if ((closeTime - zone.createdTime) / this.seconds.structure > this.strategy.maxZoneAgeBars) {
        this.finish(state, 'expired', `Older than ${this.strategy.maxZoneAgeBars} structure candles.`);
        return;
      }
      this.recordLiquiditySweep(state, candle, closeTime);
      if (state.status === 'waiting' && this.touches(zone, candle, this.tapTolerance(zone))) this.tap(state, index, closeTime);
      if (state.status === 'tapped') this.lookForConfirmation(state, index, closeTime);
    }

    tap(state, index, closeTime) {
      if (this.strategy.requireLiquiditySweep && !state.sweptSwing) {
        this.finish(state, 'skipped', 'Price tapped the level before any liquidity was taken ("if you don\'t see liquidity, you are the liquidity").');
        return;
      }
      const biasProblem = this.biasProblem(state.zone, closeTime);
      if (biasProblem) { this.finish(state, 'skipped', biasProblem); return; }
      state.status = 'tapped';
      state.tapIndex = index;
      state.extremeSinceTap = this.extremeOf(state.zone, this.entry[index]);
      state.reason = 'Price is at the level. Waiting for an entry-timeframe confirmation.';
    }

    lookForConfirmation(state, index, closeTime) {
      const { zone } = state;
      const candle = this.entry[index];
      state.extremeSinceTap = zone.direction === 'sell'
        ? Math.max(state.extremeSinceTap, candle.high) : Math.min(state.extremeSinceTap, candle.low);
      const buffer = this.stopBuffer(index);
      const closedThrough = zone.direction === 'sell' ? candle.close > zone.level + buffer : candle.close < zone.level - buffer;
      if (closedThrough) { this.finish(state, 'invalidated', 'A candle closed through the level before any confirmation.'); return; }

      const confirmation = this.confirmationAt(state, index);
      if (confirmation) { this.openTradeFrom(state, index, closeTime, confirmation); return; }
      if (index - state.tapIndex >= this.strategy.confirmWindowBars) {
        this.finish(state, 'expired', `No confirmation within ${this.strategy.confirmWindowBars} entry candles of the tap.`);
      }
    }

    finish(state, status, reason) {
      state.status = status;
      state.reason = reason;
    }

    recordLiquiditySweep(state, candle, closeTime) {
      if (state.sweptSwing) return;
      const { zone } = state;
      const wantedType = zone.direction === 'sell' ? 'high' : 'low';
      const tolerance = this.tapTolerance(zone);
      state.sweptSwing = this.liquiditySwings.find((swing) => swing.type === wantedType
        && swing.index > zone.createdIndex
        && swing.confirmTime <= closeTime
        && (zone.direction === 'sell'
          ? swing.extreme < zone.level - tolerance && candle.high > swing.extreme
          : swing.extreme > zone.level + tolerance && candle.low < swing.extreme)) || null;
    }

    biasProblem(zone, time) {
      if (!this.strategy.followBias[zone.model]) return null;
      const trend = this.biasTrendAt(time);
      const wanted = zone.direction === 'buy' ? 'up' : 'down';
      if (trend === wanted) return null;
      return `Higher-timeframe trend is ${trend === 'none' ? 'unclear' : trend}; this model only trades with the trend.`;
    }

    biasTrendAt(time) {
      const index = C.lastIndexAtOrBefore(this.biasCandles, time - this.seconds.bias);
      return index < 0 ? 'none' : this.bias.trendAt[index];
    }

    // ---------- confirmation ----------

    confirmationAt(state, index) {
      const { zone } = state;
      const wanted = this.strategy.confirmations;
      const candle = this.entry[index];
      const previous = this.entry[index - 1];
      const tolerance = this.tapTolerance(zone);
      const touchedNow = this.touches(zone, candle, tolerance);
      const touchedBefore = index - 1 >= state.tapIndex && this.touches(zone, previous, tolerance);
      const selling = zone.direction === 'sell';

      if (wanted.engulfing && (touchedNow || touchedBefore)
        && (selling ? C.isBearishEngulfing(previous, candle) : C.isBullishEngulfing(previous, candle))) {
        return selling ? 'Bearish engulfing at the level' : 'Bullish engulfing at the level';
      }
      if (wanted.pinBar && touchedNow && (selling ? C.isBearishPinBar(candle) : C.isBullishPinBar(candle))) {
        return selling ? 'Bearish pin bar rejected the level' : 'Bullish pin bar rejected the level';
      }
      if (wanted.lowerTimeframeChoch && this.entryChangeOfCharacter(state, index)) {
        return `Entry-timeframe change of character (close ${selling ? 'below' : 'above'} the last swing)`;
      }
      if (wanted.doji && touchedNow && C.isDoji(candle) && (selling ? candle.close < zone.level : candle.close > zone.level)) {
        return 'Doji rejection at the level';
      }
      if (wanted.insideBar && touchedBefore && C.isInsideBar(previous, candle) && (selling ? C.isBearish(candle) : C.isBullish(candle))) {
        return 'Inside bar after the tap';
      }
      return null;
    }

    entryChangeOfCharacter(state, index) {
      const selling = state.zone.direction === 'sell';
      const wantedType = selling ? 'low' : 'high';
      let swing = null;
      for (let position = this.entrySwings.length - 1; position >= 0; position--) {
        const candidate = this.entrySwings[position];
        if (candidate.index < state.tapIndex - CHOCH_LOOKBACK_BARS) break;
        if (candidate.type === wantedType && candidate.confirmedIndex <= index && candidate.index < index) { swing = candidate; break; }
      }
      if (!swing) return false;
      const close = this.entry[index].close;
      return selling ? close < swing.extreme : close > swing.extreme;
    }

    // ---------- trades ----------

    openTradeFrom(state, index, closeTime, confirmation) {
      const biasProblem = this.biasProblem(state.zone, closeTime);
      if (biasProblem) { this.finish(state, 'skipped', biasProblem); return; }
      if (this.strategy.oneTradeAtATime && this.openTrade) {
        this.finish(state, 'skipped', `Confirmed (${confirmation}) while another trade was still open.`);
        return;
      }
      const plan = this.planTrade(state.zone, this.entry[index].close, state.extremeSinceTap, this.stopBuffer(index), closeTime);
      state.confirmation = confirmation;
      if (!plan.ok) { this.finish(state, 'skipped', plan.reason); return; }

      const trade = {
        ...plan, id: `${state.zone.id}@${closeTime}`, zone: state.zone, model: state.zone.model, confirmation,
        entryIndex: index, entryTime: closeTime, status: 'open', partialTaken: false,
        stop: plan.initialStop, exitTime: null, exitPrice: null, exitReason: null,
        grossR: null, netR: null, costR: this.costInR(plan.risk, plan.entry), session: APA.sessions.label(closeTime),
      };
      state.trade = trade;
      this.trades.push(trade);
      this.openTrade = trade;
      this.finish(state, 'triggered', `${confirmation}. Trade opened.`);
    }

    /** Entry, stop, liquidity target and reward-to-risk for a zone. Also used for "proposed" plans. */
    planTrade(zone, entry, extreme, buffer, time) {
      const selling = zone.direction === 'sell';
      const initialStop = selling ? Math.max(zone.level, extreme) + buffer : Math.min(zone.level, extreme) - buffer;
      const risk = Math.abs(initialStop - entry);
      const wrongSide = selling ? initialStop <= entry : initialStop >= entry;
      if (risk <= 0 || wrongSide) return { ok: false, reason: 'Entry would sit beyond the stop; no valid risk.' };

      const liquidity = this.liquidityTarget(zone.direction, entry, time);
      const sign = selling ? -1 : 1;
      const rewardToRisk = liquidity ? Math.abs(liquidity.price - entry) / risk : this.strategy.fallbackTargetR;
      const base = { direction: selling ? 'sell' : 'buy', entry, initialStop, risk, rewardToRisk, liquidity };
      if (liquidity && rewardToRisk < this.strategy.minRewardToRisk) {
        return { ...base, ok: false,
          reason: `Nearest higher-timeframe liquidity is only 1:${rewardToRisk.toFixed(1)} away; the strategy needs 1:${this.strategy.minRewardToRisk}.` };
      }
      const target = liquidity ? liquidity.price : entry + sign * this.strategy.fallbackTargetR * risk;
      const takesPartial = this.strategy.partialAtR < rewardToRisk && this.strategy.partialFraction > 0;
      return { ...base, ok: true, target, partialTarget: takesPartial ? entry + sign * this.strategy.partialAtR * risk : null };
    }

    /** Nearest untaken swing on the bias timeframe beyond the entry: the "external liquidity" both videos target. */
    liquidityTarget(direction, entry, time) {
      const wantedType = direction === 'sell' ? 'low' : 'high';
      const lastClosed = C.lastIndexAtOrBefore(this.biasCandles, time - this.seconds.bias);
      let best = null;
      let considered = 0;
      for (let position = this.targetSwings.length - 1; position >= 0 && considered < TARGET_SWINGS_CONSIDERED; position--) {
        const swing = this.targetSwings[position];
        if (swing.type !== wantedType || swing.confirmTime > time) continue;
        considered++;
        const beyond = direction === 'sell' ? swing.extreme < entry : swing.extreme > entry;
        if (!beyond || this.swingTaken(swing, lastClosed, direction)) continue;
        const closer = !best || (direction === 'sell' ? swing.extreme > best.price : swing.extreme < best.price);
        if (closer) best = { price: swing.extreme, time: swing.time };
      }
      return best;
    }

    swingTaken(swing, lastClosed, direction) {
      for (let index = swing.index + 1; index <= lastClosed; index++) {
        const candle = this.biasCandles[index];
        if (direction === 'sell' ? candle.low < swing.extreme : candle.high > swing.extreme) return true;
      }
      return false;
    }

    manageTrade(trade, index) {
      const candle = this.entry[index];
      const selling = trade.direction === 'sell';
      const reached = (price) => (selling ? candle.low <= price : candle.high >= price);
      const stopped = selling ? candle.high >= trade.stop : candle.low <= trade.stop;
      const partialR = this.strategy.partialFraction * this.strategy.partialAtR;
      const closeTime = candle.time + this.seconds.entry;

      // When one candle spans both stop and target, assume the stop came first (the cautious reading).
      if (!trade.partialTaken && stopped) { this.closeTrade(trade, -1, trade.stop, 'Stop loss', closeTime); return; }
      if (trade.partialTaken && stopped) { this.closeTrade(trade, partialR, trade.stop, 'Break-even after TP1', closeTime); return; }
      if (!trade.partialTaken && trade.partialTarget !== null && reached(trade.partialTarget)) {
        trade.partialTaken = true;
        trade.stop = trade.entry;
      }
      if (reached(trade.target)) {
        const finalR = trade.partialTaken
          ? partialR + (1 - this.strategy.partialFraction) * trade.rewardToRisk
          : trade.rewardToRisk;
        this.closeTrade(trade, finalR, trade.target, 'Liquidity target', closeTime);
      }
    }

    closeTrade(trade, grossR, exitPrice, reason, time) {
      Object.assign(trade, { status: 'closed', grossR, netR: grossR - trade.costR, exitPrice, exitReason: reason, exitTime: time });
      this.openTrade = null;
    }

    /** Spread plus slippage on both fills, and commission, expressed as a fraction of the trade's risk. */
    costInR(risk, entry) {
      const priceCost = this.instrument.spread + 2 * this.costs.slippagePrice;
      const usdPerLotPerUnit = this.instrument.contractSize * APA.instruments.usdPerPriceUnit(this.instrument, entry);
      const commissionR = this.costs.commissionPerLot / (risk * usdPerLotPerUnit);
      return priceCost / risk + commissionR;
    }

    // ---------- helpers ----------

    touches(zone, candle, tolerance) {
      return zone.direction === 'sell' ? candle.high >= zone.level - tolerance : candle.low <= zone.level + tolerance;
    }

    extremeOf(zone, candle) {
      return zone.direction === 'sell' ? candle.high : candle.low;
    }

    tapTolerance(zone) {
      return zone.averageRange * this.strategy.tapToleranceRanges;
    }

    stopBuffer(index) {
      return C.averageRange(this.entry, index) * this.strategy.stopBufferRanges;
    }

    nowTime() {
      const last = this.entry[this.entry.length - 1];
      return last.time + this.seconds.entry;
    }
  }

  function run(input) {
    if (input.candleSets.entry.length < 50) throw new Error('Need at least 50 closed entry candles to run the strategy.');
    if (input.candleSets.structure.length < 30) throw new Error('Need at least 30 closed structure candles.');
    return new Simulation(input).run();
  }

  APA.engine = { run, Simulation };
})((globalThis.APA = globalThis.APA || {}));
