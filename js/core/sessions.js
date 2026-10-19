(function (APA) {
  'use strict';

  // Neither video names a trading session, so sessions are used for analytics only, never as a filter.
  const SESSIONS = [
    { name: 'Asia', fromHour: 0, toHour: 7 },
    { name: 'London', fromHour: 7, toHour: 12 },
    { name: 'London / New York', fromHour: 12, toHour: 16 },
    { name: 'New York', fromHour: 16, toHour: 21 },
    { name: 'Late', fromHour: 21, toHour: 24 },
  ];

  function label(epochSeconds) {
    const hour = new Date(epochSeconds * 1000).getUTCHours();
    return SESSIONS.find((session) => hour >= session.fromHour && hour < session.toHour).name;
  }

  APA.sessions = { all: SESSIONS, label };
})((globalThis.APA = globalThis.APA || {}));
