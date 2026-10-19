(function (APA) {
  'use strict';

  const { $, $$, escapeHtml, showFieldError, clearFieldErrors } = APA.ui;
  const UNVERIFIED = '<span class="unverified">UNVERIFIED</span>';

  // Numeric settings: [path, label, min, max, step, hint, isGuess]
  const NUMBER_FIELDS = {
    structure: [
      ['strategy.swingStrength', 'Swing size (candles each side)', 1, 10, 1, 'Structure timeframe', true],
      ['strategy.entrySwingStrength', 'Entry swing size', 1, 10, 1, 'For the entry-timeframe change of character', true],
    ],
    entry: [
      ['strategy.tapToleranceRanges', 'Tap tolerance', 0, 2, 0.05, '× average structure candle range', true],
      ['strategy.stopBufferRanges', 'Stop buffer ("a few pips")', 0, 5, 0.05, '× average entry candle range', true],
      ['strategy.confirmWindowBars', 'Confirmation window', 1, 500, 1, 'Entry candles after the tap', true],
      ['strategy.maxZoneAgeBars', 'Zone lifetime', 10, 5000, 10, 'Structure candles', true],
      ['strategy.minLevelTouches', 'SBR / RBS touches', 1, 6, 1, 'Times a level must hold', true],
      ['strategy.levelToleranceRanges', 'Level match tolerance', 0, 2, 0.05, '× average range, for counting touches', true],
      ['strategy.impulseBodyFactor', 'OCL impulse size', 0.5, 5, 0.1, '× average body', true],
    ],
    targets: [
      ['strategy.minRewardToRisk', 'Minimum reward : risk', 1, 20, 0.5, 'V1 19:20 says 1:3', false],
      ['strategy.partialAtR', 'Take partial at (R)', 0.5, 20, 0.5, 'V1 37:00 says 1:3', false],
      ['strategy.partialFraction', 'Partial size (0–1)', 0, 1, 0.05, 'V1 says 50%', false],
      ['strategy.fallbackTargetR', 'Target when no liquidity found (R)', 1, 30, 0.5, 'Used only if no swing is beyond entry', true],
    ],
    risk: [
      ['risk.balance', 'Account balance (USD)', 1, 1e9, 'any', '', false],
      ['risk.riskPercent', 'Risk per trade (%)', 0.01, 100, 0.1, 'V1 16:42: 1–2%', false],
      ['risk.maxRiskPercent', 'Risk cap (%)', 0.01, 100, 0.1, 'Warnings above this', false],
    ],
    chart: [
      ['chart.maxZonesShown', 'Zones drawn on the chart', 1, 30, 1, 'Nearest to price', false],
    ],
  };

  const INSTRUMENT_FIELDS = [['contractSize', 'Contract size'], ['pipSize', 'Pip size'], ['minLot', 'Min lot'], ['lotStep', 'Lot step'], ['spread', 'Spread']];

  const view = {
    title: 'Settings',
    subtitle: 'Strategy parameters, risk limits, chart and data source',

    mount(section, app) {
      this.section = section;
      this.app = app;
      section.addEventListener('submit', (event) => { event.preventDefault(); this.save(); });
      section.addEventListener('click', (event) => this.handleClick(event));
      section.addEventListener('change', (event) => { if (event.target.name === 'csvFile') this.loadCsv(event.target); });
      this.render();
    },

    show() { this.render(); },

    render() {
      const settings = this.app.settings;
      const strategy = settings.strategy;
      const timeframeSelect = (path, keys) => `<select data-path="${path}" name="${path}">${keys.map((key) => `<option value="${key}" ${get(settings, path) === key ? 'selected' : ''}>${APA.timeframes.byKey(key).label}</option>`).join('')}</select>`;
      this.section.innerHTML = `
        <form data-slot="form" novalidate class="grid" style="gap:18px">
          <div class="panel settings-section">
            <div class="panel-head"><div><h2>${APA.icons.layers}Timeframes and structure</h2><p>Videos: mark structure on 4H/1H, enter on 5m or 1m.</p></div></div>
            <div class="form-grid">
              <label class="field"><span>Structure timeframe (zones)</span>${timeframeSelect('strategy.structureTimeframe', ['15m', '1h', '4h'])}</label>
              <label class="field"><span>Bias timeframe (trend + targets)</span>${timeframeSelect('strategy.biasTimeframe', ['1h', '4h', '1d'])}</label>
              <label class="field"><span>Entry timeframe</span>${timeframeSelect('strategy.entryTimeframe', ['1m', '5m', '15m'])}</label>
              ${numberInputs(settings, NUMBER_FIELDS.structure)}
            </div>
          </div>

          <div class="panel settings-section">
            <div class="panel-head"><div><h2>${APA.icons.rules}Entry models</h2><p>Turn models off if your backtest shows a market ignores them.</p></div></div>
            <div class="table-wrap"><table class="model-table"><thead><tr><th>Model</th><th>Enabled</th><th>Only with the trend</th><th>Source</th></tr></thead><tbody>
              ${APA.zones.models.map((model) => `<tr><td><strong>${escapeHtml(model.name)}</strong><br><small class="muted">${escapeHtml(model.summary)}</small></td>
                <td><label class="toggle"><input type="checkbox" data-path="strategy.models.${model.id}" ${strategy.models[model.id] ? 'checked' : ''} aria-label="Enable ${escapeHtml(model.name)}"></label></td>
                <td><label class="toggle"><input type="checkbox" data-path="strategy.followBias.${model.id}" ${strategy.followBias[model.id] ? 'checked' : ''} aria-label="${escapeHtml(model.name)} only with the trend"></label></td>
                <td class="muted">${escapeHtml(model.video)}</td></tr>`).join('')}
            </tbody></table></div>
          </div>

          <div class="grid grid-2">
            <div class="panel settings-section">
              <div class="panel-head"><div><h2>${APA.icons.zap}Confirmation and entry</h2></div></div>
              <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
                ${[['engulfing', 'Engulfing candle', 'V2 46:04'], ['pinBar', 'Pin bar', 'V1 4:14'], ['lowerTimeframeChoch', 'Entry-timeframe change of character', 'V1 1:37:28'], ['doji', 'Doji', 'V2 19:40'], ['insideBar', 'Inside bar', 'V2 19:40']]
                  .map(([key, label, source]) => `<label class="check"><input type="checkbox" data-path="strategy.confirmations.${key}" ${strategy.confirmations[key] ? 'checked' : ''}><span>${label}<br><small class="muted">${source}</small></span></label>`).join('')}
                <label class="check"><input type="checkbox" data-path="strategy.requireLiquiditySweep" ${strategy.requireLiquiditySweep ? 'checked' : ''}><span>Liquidity must be taken first<br><small class="muted">V1 16:42</small></span></label>
                <label class="check"><input type="checkbox" data-path="strategy.oneTradeAtATime" ${strategy.oneTradeAtATime ? 'checked' : ''}><span>One open trade at a time</span></label>
              </div>
              <div class="form-grid">${numberInputs(settings, NUMBER_FIELDS.entry)}</div>
            </div>
            <div class="grid" style="align-content:start;gap:18px">
              <div class="panel settings-section">
                <div class="panel-head"><div><h2>${APA.icons.target}Targets</h2></div></div>
                <div class="form-grid">${numberInputs(settings, NUMBER_FIELDS.targets)}</div>
              </div>
              <div class="panel settings-section">
                <div class="panel-head"><div><h2>${APA.icons.shield}Risk limits</h2></div></div>
                <div class="form-grid">${numberInputs(settings, NUMBER_FIELDS.risk)}</div>
              </div>
              <div class="panel settings-section">
                <div class="panel-head"><div><h2>${APA.icons.chart}Chart</h2></div></div>
                <div class="form-grid">${numberInputs(settings, NUMBER_FIELDS.chart)}</div>
              </div>
            </div>
          </div>

          <div class="panel settings-section">
            <div class="panel-head"><div><h2>${APA.icons.radar}Data source</h2><p>No API key is needed. Never put a private key in this page: anything in browser code can be read.</p></div></div>
            <div class="form-grid">
              <label class="field"><span>Source</span><select data-path="data.source" name="data.source">
                ${[['auto', 'Deriv, fall back to demo'], ['deriv', 'Deriv only'], ['demo', 'Demo data'], ['csv', 'CSV file']].map(([value, label]) => `<option value="${value}" ${settings.data.source === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select></label>
              <label class="field span-2"><span>Deriv WebSocket endpoint</span><input type="text" data-path="data.derivEndpoint" name="data.derivEndpoint" value="${escapeHtml(settings.data.derivEndpoint)}"></label>
              <label class="field"><span>Deriv app_id</span><input type="text" data-path="data.derivAppId" name="data.derivAppId" value="${escapeHtml(settings.data.derivAppId)}"><small>1089 = Deriv's public id</small></label>
              <label class="field"><span>Entry candles to load</span><input type="number" data-path="data.candleCount" name="data.candleCount" min="200" max="50000" step="100" value="${settings.data.candleCount}"></label>
            </div>
            <div class="file-drop">${APA.icons.upload}<div style="flex:1;min-width:200px"><strong>Historical CSV</strong><br><small class="muted">Columns: time, open, high, low, close (header row). Load the entry timeframe or lower; higher timeframes are built from it. Then choose "CSV file" above and save.</small>
              <br><small data-slot="csv-status" class="${this.app.market.csvFeed ? 'bull' : 'muted'}">${this.app.market.csvFeed ? `Loaded: ${escapeHtml(this.app.market.csvFeed.label)} (${this.app.market.csvFeed.base.length.toLocaleString()} candles)` : 'No file loaded.'}</small></div>
              <input type="file" name="csvFile" accept=".csv,text/csv" aria-label="Choose a CSV file"></div>
          </div>

          <div class="panel settings-section">
            <div class="panel-head"><div><h2>${APA.icons.calculator}Instruments</h2><p>Contract specs differ between brokers and account types. Check yours.</p></div></div>
            <div class="table-wrap"><table class="instrument-table"><thead><tr><th>Instrument</th>${INSTRUMENT_FIELDS.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>
              ${this.app.instruments.map((instrument) => `<tr><td><strong>${escapeHtml(instrument.shortName)}</strong><br><small class="muted">${escapeHtml(instrument.symbol)}</small></td>
                ${INSTRUMENT_FIELDS.map(([key, label]) => `<td><input type="number" step="any" min="0" name="instrument.${instrument.symbol}.${key}" data-instrument="${instrument.symbol}" data-key="${key}" value="${instrument[key]}" aria-label="${escapeHtml(instrument.shortName)} ${label}"></td>`).join('')}</tr>`).join('')}
            </tbody></table></div>
          </div>

          <div class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;position:sticky;bottom:12px;z-index:5">
            <button class="button" type="submit">Save settings</button>
            <button class="button button-ghost" type="button" data-action="reset">Reset to defaults</button>
            <span class="muted" style="font-size:12px">Saving re-runs the strategy on the selected market.</span>
          </div>
        </form>`;
    },

    readForm(form) {
      const next = JSON.parse(JSON.stringify(this.app.settings));
      for (const input of $$('[data-path]', form)) {
        const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value.trim();
        if (input.type === 'number' && (input.value === '' || !Number.isFinite(value) || value < Number(input.min) || (input.max && value > Number(input.max)))) {
          throw new FieldProblem(input.name, `${input.closest('.field').querySelector('span').firstChild.textContent} must be between ${input.min} and ${input.max}.`);
        }
        set(next, input.dataset.path, value);
      }
      for (const input of $$('[data-instrument]', form)) {
        const value = Number(input.value);
        if (!(value >= 0) || input.value === '' || (input.dataset.key !== 'spread' && value === 0)) {
          throw new FieldProblem(input.name, `${input.getAttribute('aria-label')} must be a positive number.`);
        }
        next.instrumentOverrides[input.dataset.instrument] = { ...(next.instrumentOverrides[input.dataset.instrument] || {}), [input.dataset.key]: value };
      }
      validate(next);
      return next;
    },

    async save() {
      const form = $('[data-slot="form"]', this.section);
      clearFieldErrors(form);
      let next;
      try {
        next = this.readForm(form);
      } catch (error) {
        if (!(error instanceof FieldProblem)) throw error;
        showFieldError(form, error.field, error.message);
        return;
      }
      const reconnect = ['source', 'derivEndpoint', 'derivAppId'].some((key) => next.data[key] !== this.app.settings.data[key]);
      APA.ui.toast('Settings saved. Re-running the strategy…');
      await this.app.updateSettings(next, { reconnect });
      this.render();
    },

    handleClick(event) {
      const button = event.target.closest('[data-action="reset"]');
      if (!button) return;
      if (button.dataset.armed !== 'true') {
        button.dataset.armed = 'true';
        button.textContent = 'Click again to reset everything';
        button.classList.add('button-danger');
        setTimeout(() => { if (button.isConnected) { button.dataset.armed = 'false'; button.textContent = 'Reset to defaults'; button.classList.remove('button-danger'); } }, 3500);
        return;
      }
      const defaults = APA.settings.reset();
      APA.ui.toast('Settings reset to the defaults.');
      this.app.updateSettings(defaults, { reconnect: true }).then(() => this.render());
    },

    async loadCsv(input) {
      const file = input.files && input.files[0];
      if (!file) return;
      const status = $('[data-slot="csv-status"]', this.section);
      try {
        const feed = this.app.market.loadCsv(file.name, await file.text());
        status.className = 'bull';
        status.textContent = `Loaded ${file.name}: ${feed.base.length.toLocaleString()} candles of ${feed.baseSeconds / 60} minutes. Choose "CSV file" as the source and save.`;
        $('[name="data.source"]', this.section).value = 'csv';
        APA.ui.toast('CSV loaded. Press Save to use it.');
      } catch (error) {
        status.className = 'bear';
        status.textContent = error.message;
        APA.ui.toast(`CSV not loaded: ${error.message}`, 'error');
      }
    },
  };

  class FieldProblem extends Error {
    constructor(field, message) { super(message); this.field = field; }
  }

  function validate(next) {
    const seconds = (key) => APA.timeframes.byKey(key).seconds;
    const { entryTimeframe, structureTimeframe, biasTimeframe } = next.strategy;
    if (seconds(structureTimeframe) <= seconds(entryTimeframe)) throw new FieldProblem('strategy.structureTimeframe', 'The structure timeframe must be higher than the entry timeframe.');
    if (seconds(biasTimeframe) < seconds(structureTimeframe)) throw new FieldProblem('strategy.biasTimeframe', 'The bias timeframe must be the same as or higher than the structure timeframe.');
    if (next.strategy.partialFraction > 0 && next.strategy.partialAtR > next.strategy.minRewardToRisk) {
      throw new FieldProblem('strategy.partialAtR', 'Take the partial at or before the minimum reward : risk.');
    }
    if (next.risk.riskPercent > next.risk.maxRiskPercent) throw new FieldProblem('risk.riskPercent', `Risk per trade is above your ${next.risk.maxRiskPercent}% cap. Lower it or raise the cap.`);
    if (!/^wss:\/\//.test(next.data.derivEndpoint)) throw new FieldProblem('data.derivEndpoint', 'The endpoint must start with wss://');
    if (!Object.values(next.strategy.models).some(Boolean)) throw new FieldProblem('strategy.swingStrength', 'Enable at least one entry model.');
    if (!Object.values(next.strategy.confirmations).some(Boolean)) throw new FieldProblem('strategy.tapToleranceRanges', 'Enable at least one confirmation type.');
  }

  function numberInputs(settings, fields) {
    return fields.map(([path, label, min, max, step, hint, isGuess]) => `
      <label class="field"><span>${escapeHtml(label)}${isGuess ? UNVERIFIED : ''}</span>
        <input type="number" data-path="${path}" name="${path}" min="${min}" max="${max}" step="${step}" value="${get(settings, path)}">
        ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</label>`).join('');
  }

  function get(object, path) {
    return path.split('.').reduce((value, key) => (value ? value[key] : undefined), object);
  }

  function set(object, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((holder, key) => holder[key], object)[last] = value;
  }

  APA.views = APA.views || {};
  APA.views.settings = view;
})((globalThis.APA = globalThis.APA || {}));
