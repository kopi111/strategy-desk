(function (APA) {
  'use strict';

  // Everything a trader reads about the strategy in the app: the two source videos, the shared rules with the
  // timestamp each comes from, the manual checklist and the pattern sketches. Mirrors docs/STRATEGY-RULES.md.
  const VIDEOS = {
    V1: { id: 'jLRm2poYbec', title: 'A.P.A Trading Strategy Full Course (MSNR)', channel: 'Mr Leo Fx', length: '2:32:53',
      focus: '17:31', note: 'Seven entry models on GBPUSD, Gold and AUDUSD, each replayed bar by bar.' },
    V2: { id: 'OiEj6AQIris', title: 'A.P.A Live Class Explaining The Full Strategy', channel: 'Tradebyladen', length: '1:03:32',
      focus: '8:27', note: 'Invalidation, New invalidation and Invalidation X, shown live on Volatility 75.' },
  };

  function seconds(timestamp) {
    return timestamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  }

  function link(video, timestamp) {
    return `https://www.youtube.com/watch?v=${VIDEOS[video].id}&t=${seconds(timestamp)}s`;
  }

  const SHARED_RULES = [
    { rule: 'Mark structure on the higher timeframe (daily → 4H → 1H); enter on 15m / 5m / 1m', sources: [['V1', '0:00'], ['V2', '41:52']] },
    { rule: 'Uptrend = higher highs and higher lows; downtrend = lower highs and lower lows', sources: [['V2', '0:31']] },
    { rule: 'A break only counts when a candle body closes beyond the swing ("we don\'t want wicks")', sources: [['V1', '2:26:13'], ['V2', '12:29']] },
    { rule: 'Draw levels on candle bodies; switch to a line chart if unsure', sources: [['V1', '49:20'], ['V2', '7:16']] },
    { rule: 'First break against the trend = change of character / market structure shift', sources: [['V1', '48:17'], ['V2', '3:05']] },
    { rule: 'Wait for price to return to the level. No tap, no trade', sources: [['V1', '11:00'], ['V1', '1:36:27']] },
    { rule: 'Confirm on the entry timeframe: rejection candle or lower-timeframe change of character', sources: [['V1', '4:14'], ['V2', '39:40']] },
    { rule: 'Stop a few pips beyond the key level (or beyond the engulfing candle)', sources: [['V1', '5:16'], ['V2', '43:27']] },
    { rule: 'Aim for at least 1:3; a 1:2 setup was turned down', sources: [['V1', '19:20']] },
    { rule: 'Close 50% at 1:3, move the stop to break-even, let the rest run to higher-timeframe liquidity', sources: [['V1', '37:00'], ['V1', '55:06']] },
    { rule: 'Risk only 1–2% of the account per trade', sources: [['V1', '16:42']] },
    { rule: 'Trade with the higher-timeframe trend', sources: [['V1', '45:12']] },
    { rule: 'Liquidity must be taken first: "if you don\'t spot the liquidity, you are the liquidity"', sources: [['V1', '16:42'], ['V1', '1:14:20']] },
    { rule: 'Not every pair respects every structure; backtest each pair', sources: [['V2', '24:27'], ['V2', '48:07']] },
  ];

  const GAPS = [
    ['"Daily confirmation"', 'V2 54:17 names it and leaves it for "another class". Kept as an optional manual check only.'],
    ['How many pips is "a few"', 'Neither video gives a number. Default: half the average entry-candle range.'],
    ['Touches needed for an SBR/RBS level', 'Shown, never counted. Default: 2.'],
    ['Swing size', 'Read by eye. Default: 3 candles either side.'],
    ['Trading sessions', 'Never named. Sessions appear in analytics only.'],
  ];

  const MODEL_GUIDE = {
    qmInvalidation: {
      direction: 'Both', sources: [['V1', '1:58:21'], ['V2', '2:04']],
      steps: ['Trend making HH/HL (or LL/LH)', 'First change of character by a body close', 'Key level: left shoulder = second-to-last high (low), on the body', 'Wait for the return, confirm on 5m'],
      checks: [
        ['Trend was clear before the break (HH/HL or LL/LH)', ['V1', '2:02:29']],
        ['First change of character, closed with a body', ['V2', '3:05']],
        ['Level is the left shoulder / second-to-last swing, drawn on bodies', ['V2', '13:00']],
      ],
      sketch: { path: [[10, 104], [48, 70], [76, 88], [116, 36], [148, 66], [188, 18], [222, 92], [256, 38], [292, 108]],
        level: { y: 36, from: 116, to: 292 }, labels: [[110, 28, 'left shoulder'], [214, 106, 'CHoCH'], [244, 30, 'entry']] },
    },
    invalidationX: {
      direction: 'Both', sources: [['V2', '32:18']],
      steps: ['Trend makes a higher low', 'Fails to make a higher high (lower high instead)', 'The higher low breaks', 'Zone = the failed lower high'],
      checks: [
        ['A higher low formed, then the next high failed to beat the last one', ['V2', '34:54']],
        ['That higher low was broken by a body close', ['V2', '35:24']],
        ['Level is the failed lower high', ['V2', '36:10']],
      ],
      sketch: { path: [[10, 106], [48, 70], [78, 88], [118, 28], [150, 70], [184, 48], [214, 96], [248, 50], [292, 112]],
        level: { y: 48, from: 184, to: 292 }, labels: [[112, 20, 'HH'], [176, 40, 'failed high'], [206, 110, 'break']] },
    },
    newInvalidation: {
      direction: 'Both', sources: [['V2', '14:00']],
      steps: ['Invalidation marked after the shift', 'Price never reaches it and forms a new swing', 'Structure breaks again', 'Focus moves to the new swing; the old level stays valid'],
      checks: [
        ['Price never reached the first invalidation', ['V2', '14:31']],
        ['A new swing formed and structure broke again', ['V2', '15:02']],
        ['Watching the new swing first, old invalidation as backup', ['V2', '16:04']],
      ],
      sketch: { path: [[10, 110], [40, 72], [62, 86], [92, 28], [116, 58], [142, 18], [170, 80], [200, 52], [230, 96], [262, 54], [292, 112]],
        level: { y: 52, from: 200, to: 292 }, oldLevel: { y: 28, from: 92, to: 292 }, labels: [[84, 20, 'invalidation'], [190, 44, 'new'], [222, 110, 'BOS']] },
    },
    aFormation: {
      direction: 'Sell', sources: [['V1', '41:37']],
      steps: ['Higher timeframe bearish, price rallies into supply', 'Change of character down on 1H', 'A level = body of the peak', 'Liquidity below is taken, price taps the A level, 5m rejection'],
      checks: [
        ['Higher timeframe is bearish and price is in supply', ['V1', '45:12']],
        ['1H change of character down from the peak', ['V1', '48:17']],
        ['A level drawn on the body of the peak', ['V1', '49:20']],
      ],
      sketch: { path: [[10, 24], [50, 80], [76, 60], [112, 98], [160, 36], [186, 62], [206, 52], [232, 86], [262, 38], [292, 110]],
        level: { y: 36, from: 160, to: 292 }, labels: [[150, 28, 'A'], [198, 46, 'liquidity'], [252, 30, 'entry']] },
    },
    vFormation: {
      direction: 'Buy', sources: [['V1', '1:07:30']],
      steps: ['Break of structure up', 'V level = lowest body before the break', 'Second break leaves liquidity above the V', 'Liquidity swept, tap of the V, 5m confirmation'],
      checks: [
        ['Break of structure up on the structure timeframe', ['V1', '1:11:46']],
        ['V level drawn on the lowest body before the break', ['V1', '1:12:48']],
        ['A second break left liquidity above the V, and it was swept', ['V1', '1:14:51']],
      ],
      sketch: { path: [[10, 96], [50, 40], [76, 60], [112, 22], [160, 84], [186, 58], [206, 68], [232, 34], [262, 82], [292, 10]],
        level: { y: 84, from: 160, to: 292 }, labels: [[152, 100, 'V'], [198, 82, 'liquidity'], [252, 98, 'entry']] },
    },
    ocl: {
      direction: 'Both', sources: [['V1', '2:07'], ['V1', '30:45']],
      steps: ['Two impulsive candles of the same colour', 'OCL = where candle 1 closes and candle 2 opens', 'Pick the fresh OCL closest to the break of structure', 'Pull-back to the OCL, sweep, 5m change of character'],
      checks: [
        ['Two consecutive impulsive same-colour candles', ['V1', '3:08']],
        ['The OCL is the one closest to the latest break of structure', ['V1', '29:08']],
        ['The OCL is still fresh (price has not traded back into it)', ['V1', '17:14']],
      ],
      sketch: { path: [[10, 104], [62, 96]], candles: [[70, 96, 70], [86, 70, 40]], tail: [[94, 40], [130, 26], [160, 52], [188, 70], [218, 40], [252, 22], [292, 12]],
        level: { y: 70, from: 70, to: 292 }, labels: [[110, 84, 'OCL'], [180, 84, 'entry']] },
    },
    sbr: {
      direction: 'Sell', sources: [['V1', '1:28:13']],
      steps: ['Support that price reacted from', 'Body close below it', 'Retest from below', '5m change of character, sell'],
      checks: [
        ['The level held as support before', ['V1', '1:31:21']],
        ['A body closed below the support', ['V1', '1:32:21']],
        ['Price retests the old support from below', ['V1', '1:33:22']],
      ],
      sketch: { path: [[10, 30], [40, 78], [70, 48], [100, 79], [130, 54], [158, 104], [188, 112], [216, 80], [252, 104], [292, 114]],
        level: { y: 80, from: 30, to: 292 }, labels: [[50, 94, 'support'], [206, 70, 'retest']] },
    },
    rbs: {
      direction: 'Buy', sources: [['V1', '1:47:55']],
      steps: ['Resistance that pushed price down', 'Body close above it', 'Retest from above', '5m change of character, buy'],
      checks: [
        ['The level held as resistance before', ['V1', '1:50:32']],
        ['A body closed above the resistance', ['V1', '1:51:04']],
        ['Price retests the old resistance from above', ['V1', '1:52:06']],
      ],
      sketch: { path: [[10, 90], [40, 42], [70, 72], [100, 41], [130, 66], [158, 16], [188, 8], [216, 40], [252, 16], [292, 6]],
        level: { y: 40, from: 30, to: 292 }, labels: [[50, 32, 'resistance'], [206, 56, 'retest']] },
    },
  };

  const COMMON_CHECKS = [
    { id: 'htf', text: 'Higher-timeframe structure marked (daily → 4H → 1H)', source: ['V2', '42:12'], mandatory: true },
    { id: 'bodies', text: 'Key level drawn on candle bodies, not wicks', source: ['V1', '49:20'], mandatory: true },
    { id: 'tap', text: 'Price has returned to the level', source: ['V1', '11:00'], mandatory: true },
    { id: 'liquidity', text: 'Liquidity was taken before the tap', source: ['V1', '1:14:20'], mandatory: true },
    { id: 'confirm', text: 'Entry-timeframe confirmation: engulfing, pin bar or change of character', source: ['V2', '39:40'], mandatory: true },
    { id: 'stop', text: 'Stop a few pips beyond the level / engulfing candle', source: ['V1', '5:16'], mandatory: true },
    { id: 'reward', text: 'Reward is at least 1:3 to the next liquidity', source: ['V1', '19:20'], mandatory: true },
    { id: 'risk', text: 'Risk is 1–2% of the account or less', source: ['V1', '16:42'], mandatory: true },
    { id: 'partial', text: 'Plan: close 50% at 1:3 and move the stop to break-even', source: ['V1', '37:00'], mandatory: false },
    { id: 'daily', text: 'Daily confirmation (named in V2 but not explained: UNVERIFIED)', source: ['V2', '54:17'], mandatory: false },
  ];

  /** Manual checklist for one model: the shared checks plus the model's own, in trading order. */
  function checklistFor(modelId) {
    const guide = MODEL_GUIDE[modelId];
    const modelChecks = guide.checks.map(([text, source], index) => ({ id: `${modelId}-${index}`, text, source, mandatory: true }));
    const trendCheck = { id: 'trend', text: 'Trading with the higher-timeframe trend', source: ['V1', '45:12'],
      mandatory: Boolean(APA.settings.defaults().strategy.followBias[modelId]) };
    return [COMMON_CHECKS[0], ...modelChecks, trendCheck, ...COMMON_CHECKS.slice(1)];
  }

  APA.strategyGuide = { VIDEOS, SHARED_RULES, GAPS, MODEL_GUIDE, link, checklistFor };
})((globalThis.APA = globalThis.APA || {}));
