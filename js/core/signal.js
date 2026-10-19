(function (APA) {
  'use strict';

  const C = APA.candles;

  /**
   * Turns a finished simulation into what the dashboard shows: BUY / SELL / WAIT / NO TRADE, the zone in focus,
   * a pass/fail checklist and a proposed trade plan. Reads the simulation; never changes it.
   */
  function describe(simulation) {
    const lastIndex = simulation.entry.length - 1;
    const now = simulation.nowTime();
    const lastClose = simulation.entry[lastIndex].close;
    const biasTrend = simulation.biasTrendAt(now);
    const live = simulation.liveStates.slice().sort((first, second) =>
      Math.abs(first.zone.level - lastClose) - Math.abs(second.zone.level - lastClose));
    const tapped = live.find((state) => state.status === 'tapped');
    const openTrade = simulation.openTrade;

    let status = 'NO TRADE';
    let focus = null;
    if (openTrade) {
      status = openTrade.direction === 'buy' ? 'BUY' : 'SELL';
      focus = simulation.states.find((state) => state.trade === openTrade);
    } else if (tapped) {
      status = 'WAIT';
      focus = tapped;
    } else if (live.length) {
      status = 'WAIT';
      focus = live[0];
    }

    const plan = focus ? planFor(simulation, focus, lastIndex, now) : null;
    return {
      status,
      headline: headline(status, focus, openTrade, lastIndex, simulation.strategy),
      biasTrend,
      structureTrend: simulation.structure.trendAt[simulation.structure.trendAt.length - 1] || 'none',
      lastClose,
      now,
      focus,
      plan,
      isFreshSignal: Boolean(openTrade && lastIndex - openTrade.entryIndex < simulation.strategy.freshSignalBars),
      checklist: focus ? checklist(simulation, focus, biasTrend, plan) : emptyChecklist(biasTrend),
      liveZones: live,
    };
  }

  function headline(status, focus, openTrade, lastIndex, strategy) {
    if (status === 'NO TRADE') return 'No valid zone is waiting. The strategy says: stay out until structure gives a level.';
    const name = APA.zones.model(focus.zone.model).name;
    if (openTrade) {
      const age = lastIndex - openTrade.entryIndex;
      const fresh = age < strategy.freshSignalBars ? 'New signal' : `Trade running (${age} candles)`;
      return `${fresh}: ${name} ${openTrade.direction} confirmed by ${openTrade.confirmation.toLowerCase()}.`;
    }
    if (focus.status === 'tapped') return `Price is at a ${name} level. Waiting for a rejection candle or entry-timeframe change of character.`;
    return `Watching a ${name} ${focus.zone.direction} level. Nothing to do until price returns to it.`;
  }

  function planFor(simulation, state, lastIndex, now) {
    if (state.trade) return { ...state.trade, kind: 'active' };
    const { zone } = state;
    const buffer = simulation.stopBuffer(lastIndex);
    const extreme = state.extremeSinceTap ?? zone.level;
    const plan = simulation.planTrade(zone, zone.level, extreme, buffer + simulation.tapTolerance(zone), now);
    return { ...plan, kind: 'proposed' };
  }

  const PASS = 'pass';
  const FAIL = 'fail';
  const PENDING = 'pending';
  const NOT_REQUIRED = 'n/a';

  function checklist(simulation, state, biasTrend, plan) {
    const { zone } = state;
    const strategy = simulation.strategy;
    const model = APA.zones.model(zone.model);
    const wanted = zone.direction === 'buy' ? 'up' : 'down';
    const triggered = state.status === 'triggered';
    const tapped = triggered || state.status === 'tapped';

    return [
      item('Higher-timeframe structure read', biasTrend === 'none' ? FAIL : PASS,
        biasTrend === 'none' ? 'Bias timeframe has no clear trend yet.' : `Bias timeframe trend is ${biasTrend}.`, true),
      item(`Key level: ${model.name}`, PASS, `${zone.explanation} (${model.video})`, true),
      item('Trades with the trend', !strategy.followBias[zone.model] ? NOT_REQUIRED : biasTrend === wanted ? PASS : FAIL,
        strategy.followBias[zone.model] ? `Model needs a ${wanted} bias.` : `${model.role === 'reversal' ? 'Reversal model' : 'Model'}: trend filter off in Settings.`,
        Boolean(strategy.followBias[zone.model])),
      item('Liquidity taken before the tap', !strategy.requireLiquiditySweep ? NOT_REQUIRED : state.sweptSwing ? PASS : PENDING,
        state.sweptSwing ? `Swept the swing at ${state.sweptSwing.extreme}.` : 'A swing between price and the level must be taken out first.',
        strategy.requireLiquiditySweep),
      item('Price returned to the level', tapped ? PASS : PENDING,
        tapped ? 'Level tapped.' : `Level ${zone.level} not reached yet.`, true),
      item('Entry-timeframe confirmation', triggered ? PASS : PENDING,
        state.confirmation || 'Needs an engulfing, pin bar or entry-timeframe change of character.', true),
      item(`Reward ≥ 1:${strategy.minRewardToRisk} to liquidity`, !plan ? PENDING : plan.ok ? PASS : FAIL,
        !plan ? 'No plan yet.' : plan.ok ? `1:${plan.rewardToRisk.toFixed(1)} to ${plan.liquidity ? 'higher-timeframe liquidity' : 'the fallback target'}.` : plan.reason, true),
      item('Level still intact', PASS, 'No candle has closed through the level.', true),
    ];
  }

  function emptyChecklist(biasTrend) {
    return [
      item('Higher-timeframe structure read', biasTrend === 'none' ? FAIL : PASS, `Bias timeframe trend is ${biasTrend}.`, true),
      item('Key level from an APA model', FAIL, 'No zone is active on the structure timeframe.', true),
    ];
  }

  function item(label, result, detail, mandatory) {
    return { label, result, detail, mandatory };
  }

  /** A setup is valid only when every mandatory item passes. */
  function isSetupValid(items) {
    return items.every((entry) => !entry.mandatory || entry.result === PASS || entry.result === NOT_REQUIRED);
  }

  function distanceInRanges(simulation, state) {
    const lastIndex = simulation.entry.length - 1;
    const average = C.averageRange(simulation.structureCandles, simulation.structureCandles.length - 1);
    return Math.abs(state.zone.level - simulation.entry[lastIndex].close) / average;
  }

  APA.signal = { describe, isSetupValid, distanceInRanges, RESULTS: { PASS, FAIL, PENDING, NOT_REQUIRED } };
})((globalThis.APA = globalThis.APA || {}));
