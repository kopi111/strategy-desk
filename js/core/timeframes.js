(function (APA) {
  'use strict';

  const TIMEFRAMES = [
    { key: '1m', label: '1m', seconds: 60 },
    { key: '5m', label: '5m', seconds: 300 },
    { key: '15m', label: '15m', seconds: 900 },
    { key: '1h', label: '1H', seconds: 3600 },
    { key: '4h', label: '4H', seconds: 14400 },
    { key: '1d', label: '1D', seconds: 86400 },
  ];

  function byKey(key) {
    const found = TIMEFRAMES.find((timeframe) => timeframe.key === key);
    if (!found) throw new Error(`Unknown timeframe "${key}"`);
    return found;
  }

  function bySeconds(seconds) {
    const found = TIMEFRAMES.find((timeframe) => timeframe.seconds === seconds);
    if (!found) throw new Error(`No timeframe of ${seconds} seconds`);
    return found;
  }

  APA.timeframes = { all: TIMEFRAMES, byKey, bySeconds };
})((globalThis.APA = globalThis.APA || {}));
