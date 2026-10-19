(function (APA) {
  'use strict';

  const { escapeHtml } = APA.ui;
  const guide = APA.strategyGuide;
  const COLORS = APA.chartColors;

  const view = {
    title: 'Strategy rules',
    subtitle: 'What the two videos teach, with timestamps, and how each rule maps to code',

    mount(section) {
      const videos = Object.entries(guide.VIDEOS);
      section.innerHTML = `
        <div class="rules-intro">${videos.map(([key, video]) => `
          <a class="panel video-card" href="${guide.link(key, video.focus)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
            <span class="play">${APA.icons.play}</span>
            <div><h3>${key} · ${escapeHtml(video.title)}</h3><p>${escapeHtml(video.channel)} · ${video.length} · opens at ${video.focus}</p><p>${escapeHtml(video.note)}</p></div>
          </a>`).join('')}</div>

        <div class="panel">
          <div class="panel-head"><div><h2>${APA.icons.rules}What APA is</h2></div></div>
          <div class="explain"><p>APA means "Advanced Price Action". Both presenters trade structure only: no indicators, no Fibonacci. Mark levels on the higher timeframe, wait for price to come back to one, and enter on a lower-timeframe confirmation. The engine implements the eight entry models below; anything the videos left vague is a setting, not a guess.</p></div>
        </div>

        <div class="model-grid">${APA.zones.models.map((model) => modelCard(model)).join('')}</div>

        <div class="panel">
          <div class="panel-head"><div><h2>${APA.icons.shield}Rules shared by both videos</h2><p>Each one is enforced by the engine or the checklist.</p></div></div>
          <div class="table-wrap"><table class="rule-table"><thead><tr><th>Rule</th><th>Source</th></tr></thead><tbody>
            ${guide.SHARED_RULES.map((entry) => `<tr><td>${escapeHtml(entry.rule)}</td><td>${entry.sources.map(([video, time]) => timestampLink(video, time)).join(' · ')}</td></tr>`).join('')}
          </tbody></table></div>
        </div>

        <div class="panel">
          <div class="panel-head"><div><h2>${APA.icons.clock}Not stated in the videos</h2><p>Left configurable in Settings instead of invented.</p></div></div>
          <div class="table-wrap"><table class="rule-table"><tbody>
            ${guide.GAPS.map(([gap, note]) => `<tr><td>${escapeHtml(gap)} <span class="unverified">UNVERIFIED</span></td><td class="muted">${escapeHtml(note)}</td></tr>`).join('')}
          </tbody></table></div>
        </div>`;
    },
  };

  function modelCard(model) {
    const detail = guide.MODEL_GUIDE[model.id];
    return `<article class="panel model-card">
      ${sketch(detail)}
      <h3>${escapeHtml(model.name)} <span class="tag ${detail.direction === 'Sell' ? 'tag-bear' : detail.direction === 'Buy' ? 'tag-bull' : 'tag-accent'}">${detail.direction}</span></h3>
      <p>${escapeHtml(model.summary)}</p>
      <ul>${detail.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
      <div>${detail.sources.map(([video, time]) => timestampLink(video, time)).join(' · ')} <span class="faint">· ${model.role}</span></div>
    </article>`;
  }

  function timestampLink(video, time) {
    return `<a class="ts" href="${guide.link(video, time)}" target="_blank" rel="noopener">${video} ${time}</a>`;
  }

  function sketch(detail) {
    const { path, tail, candles, level, oldLevel, labels } = detail.sketch;
    const levelColor = detail.direction === 'Sell' ? COLORS.bear : detail.direction === 'Buy' ? COLORS.bull : COLORS.accent;
    const line = (points) => `<polyline points="${points.map((point) => point.join(',')).join(' ')}" fill="none" stroke="#c9d3ee" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const candleShapes = (candles || []).map(([x, open, close]) => `<rect x="${x - 5}" y="${Math.min(open, close)}" width="10" height="${Math.abs(open - close)}" rx="1.5" fill="${close < open ? COLORS.bull : COLORS.bear}"/>`).join('');
    return `<svg class="sketch" viewBox="0 0 300 120" role="img" aria-label="Sketch of the pattern">
      ${oldLevel ? `<line x1="${oldLevel.from}" x2="${oldLevel.to}" y1="${oldLevel.y}" y2="${oldLevel.y}" stroke="${COLORS.text}" stroke-dasharray="3 4" stroke-width="1.2" opacity="0.6"/>` : ''}
      <line x1="${level.from}" x2="${level.to}" y1="${level.y}" y2="${level.y}" stroke="${levelColor}" stroke-dasharray="6 4" stroke-width="1.6"/>
      ${line(path)}${tail ? line(tail) : ''}${candleShapes}
      ${(labels || []).map(([x, y, text]) => `<text x="${x}" y="${y}" fill="#8f9bb8" font-size="9.5" font-family="Plus Jakarta Sans, sans-serif">${escapeHtml(text)}</text>`).join('')}
    </svg>`;
  }

  APA.views = APA.views || {};
  APA.views.rules = view;
})((globalThis.APA = globalThis.APA || {}));
