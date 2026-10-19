(function (APA) {
  'use strict';

  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  APA.icons = {
    dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>'),
    chart: svg('<path d="M6 4v16M6 8h-2v6h2M12 6v14M12 10h-2v5h2M18 3v15M18 6h-2v7h2"/>'),
    calculator: svg('<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'),
    checklist: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>'),
    journal: svg('<path d="M5 3.5h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3z"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H19M9 7.5h6M9 11h4"/>'),
    analytics: svg('<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>'),
    backtest: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/>'),
    rules: svg('<path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z"/><path d="M8 7h6M8 11h6"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    refresh: svg('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
    menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    cross: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    dash: svg('<path d="M6 12h12"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
    upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
    target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
    zap: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    layers: svg('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
    shield: svg('<path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6z"/>'),
    radar: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 19 5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    empty: svg('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M3.5 9h17M8 14h8"/>'),
  };
})((globalThis.APA = globalThis.APA || {}));
