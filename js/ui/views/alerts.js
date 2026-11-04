(function (APA) {
  'use strict';

  const { $, $$, escapeHtml, format, emptyState, segmented, toast } = APA.ui;
  const LOG_KEY = 'strategy-desk.alert-log.v1';
  const LOG_LIMIT = 100;
  const WATCH_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h'];

  /** Plays two short rising beeps. The browser only allows sound after a click, so the player waits for one. */
  class AlertSound {
    constructor() {
      this.audio = null;
      document.addEventListener('pointerdown', () => this.unlock(), { once: true });
    }

    /** Creates the audio engine. This must run during a click or key press. */
    unlock() {
      const Engine = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!this.audio && Engine) this.audio = new Engine();
      if (this.audio && this.audio.state === 'suspended') this.audio.resume();
    }

    /** True once the browser has allowed sound. */
    isReady() {
      return Boolean(this.audio) && this.audio.state === 'running';
    }

    /** Plays the alert. Returns false when the browser has not allowed sound yet. */
    play() {
      if (!this.isReady()) return false;
      this.beep(660, 0);
      this.beep(880, 0.18);
      return true;
    }

    /** Plays one beep that fades out quickly. */
    beep(frequency, delay) {
      const start = this.audio.currentTime + delay;
      const oscillator = this.audio.createOscillator();
      const volume = this.audio.createGain();
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.25, start);
      volume.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
      oscillator.connect(volume).connect(this.audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    }
  }

  const view = {
    title: 'Alerts',
    subtitle: 'A sound and a pop-up when a setup comes into play on the markets you choose',

    mount(section, app) {
      this.section = section;
      this.app = app;
      this.sound = new AlertSound();
      this.log = APA.storage.readJson(LOG_KEY) || [];
      this.lastStatus = null;
      this.watcher = new APA.AlertWatcher({
        market: app.market,
        getConfig: () => app.settings.alerts,
        onAlerts: (alerts) => this.deliver(alerts),
        onStatus: (status) => { this.lastStatus = status; this.renderStatus(); },
      });
      section.innerHTML = `
        <div class="grid grid-sidebar">
          <div class="grid" style="align-content:start">
            <div class="panel" data-slot="alert-status"></div>
            <div class="panel" data-slot="log"></div>
          </div>
          <div class="grid" style="align-content:start">
            <div class="panel" data-slot="markets"></div>
            <div class="panel" data-slot="concepts"></div>
          </div>
        </div>`;
      section.addEventListener('click', (event) => this.handleClick(event));
      section.addEventListener('change', (event) => this.handleChange(event));
      // Alerts only ever run on real Deriv prices. Demo candles must never make a trader act.
      app.on('source', (status) => this.followSource(status));
      this.renderAll();
    },

    show() {
      this.renderAll();
    },

    /** Watches while the live feed is connected, and stops on any other source. */
    followSource(status) {
      if (status.kind === 'live') this.watcher.start();
      else if (status.kind !== 'connecting') this.watcher.stop();
      this.renderStatus();
    },

    renderAll() {
      this.renderStatus();
      this.renderMarkets();
      this.renderConcepts();
      this.renderLog();
    },

    /** Shows whether the watcher is working, and whether sound and pop-ups are allowed. */
    renderStatus() {
      const slot = $('[data-slot="alert-status"]', this.section);
      const isWatching = Boolean(this.watcher.timer);
      const status = this.lastStatus;
      const failed = status ? status.failures : [];
      const tag = !isWatching ? ['tag-bear', 'Not watching'] : failed.length ? ['tag-wait', 'Partly working'] : ['tag-bull', 'Watching'];
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.bell}Alert status</h2><p>${escapeHtml(this.statusLine(isWatching, status))}</p></div>
          <span class="tag ${tag[0]}" data-slot="watch-state">${tag[1]}</span></div>
        ${failed.length ? `<div class="note"><strong>Could not check:</strong> ${failed.map((item) => escapeHtml(this.app.instrument(item.symbol).shortName)).join(', ')}. Trying again in 30 seconds.</div>` : ''}
        <div class="alert-actions">
          <button class="button" type="button" data-action="enable-alerts">${this.permissionLabel()}</button>
          <button class="button button-ghost" type="button" data-action="test-alert">Test alert</button>
        </div>
        <p class="muted alert-note">Keep this page open, because alerts stop when the tab closes. An alert means the pattern appeared. It does not mean the trade is good.</p>`;
    },

    /** One sentence about what the watcher last did. */
    statusLine(isWatching, status) {
      if (!isWatching) return 'Alerts only run on live Deriv prices. Check the data source.';
      if (!status) return 'Taking a first look. Setups already on the chart will not alert.';
      return `${status.marketCount} markets on ${APA.timeframes.byKey(this.app.settings.alerts.timeframe).label}, last checked ${format.time(status.checkedAt)}`;
    },

    /** The main button's wording depends on what the browser has allowed so far. */
    permissionLabel() {
      if (!('Notification' in globalThis)) return 'Turn on sound';
      return Notification.permission === 'granted' ? 'Sound and pop-ups on' : 'Turn on sound and pop-ups';
    },

    renderMarkets() {
      const { alerts } = this.app.settings;
      const slot = $('[data-slot="markets"]', this.section);
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.radar}What to watch</h2><p>Timeframe and markets</p></div></div>
        <div class="segmented" data-slot="watch-timeframe" role="radiogroup" aria-label="Alert timeframe"></div>
        <div class="check-list">${this.app.instruments.map((instrument) => `
          <label class="toggle"><input type="checkbox" data-market="${escapeHtml(instrument.symbol)}" ${alerts.symbols.includes(instrument.symbol) ? 'checked' : ''}> ${escapeHtml(instrument.shortName)}</label>`).join('')}</div>`;
      segmented($('[data-slot="watch-timeframe"]', slot), WATCH_TIMEFRAMES.map((key) => ({ value: key, label: APA.timeframes.byKey(key).label })),
        alerts.timeframe, (value) => {
          alerts.timeframe = value;
          APA.settings.save(this.app.settings);
          this.renderStatus();
        });
    },

    renderConcepts() {
      const { alerts } = this.app.settings;
      $('[data-slot="concepts"]', this.section).innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.layers}Alert me about</h2><p>Untick anything that gets too noisy</p></div></div>
        <div class="concept-list">${APA.smartMoney.concepts.map((concept) => `
          <label class="concept-row"><input type="checkbox" data-concept="${concept.id}" ${alerts.concepts[concept.id] ? 'checked' : ''}>
            <span><strong>${escapeHtml(concept.name)}</strong><small>${escapeHtml(concept.summary)}</small></span></label>`).join('')}</div>`;
    },

    renderLog() {
      const slot = $('[data-slot="log"]', this.section);
      slot.innerHTML = `
        <div class="panel-head"><div><h2>${APA.icons.clock}Alert log</h2><p>Newest first. Click one to open it on the chart.</p></div>
          ${this.log.length ? '<button class="button button-ghost button-small" type="button" data-action="clear-log">Clear</button>' : ''}</div>
        ${this.log.length ? `<ul class="zone-list" data-slot="alert-list">${this.log.map((alert, position) => this.logRow(alert, position)).join('')}</ul>`
          : emptyState('No alerts yet', 'They will appear here as setups come into play.')}`;
    },

    /** One clickable row of the log. */
    logRow(alert, position) {
      const instrument = this.app.instrument(alert.symbol);
      return `<li data-action="open-alert" data-position="${position}" tabindex="0"><span class="bar ${alert.direction}"></span>
        <div><strong>${escapeHtml(instrument.shortName)} ${APA.timeframes.byKey(alert.timeframe).label}: ${escapeHtml(alert.message)}</strong>
          <small>${format.price(instrument, alert.price)} · ${format.time(alert.time)}</small></div></li>`;
    },

    /** Delivers new alerts through the log, an on-screen message, the sound and a desktop pop-up. */
    deliver(alerts) {
      this.log = [...alerts.slice().reverse(), ...this.log].slice(0, LOG_LIMIT);
      APA.storage.writeJson(LOG_KEY, this.log);
      this.renderLog();
      this.sound.play();
      for (const alert of alerts) {
        const title = `${this.app.instrument(alert.symbol).shortName} ${APA.timeframes.byKey(alert.timeframe).label}`;
        toast(`${title}: ${alert.message}`);
        this.showPopup(title, alert);
      }
    },

    /** Shows a desktop pop-up if the browser allows it. Clicking the pop-up opens that setup on the chart. */
    showPopup(title, alert) {
      if (!('Notification' in globalThis) || Notification.permission !== 'granted') return;
      const popup = new Notification(title, { body: alert.message, tag: alert.id });
      popup.onclick = () => { globalThis.focus(); this.openOnChart(alert); popup.close(); };
    },

    /** Opens the chart on the alert's market and timeframe, and makes sure that concept is drawn. */
    async openOnChart(alert) {
      const { settings } = this.app;
      settings.selected.chartTimeframe = alert.timeframe;
      settings.chart.markup[alert.concept] = true;
      APA.settings.save(settings);
      this.app.chartFocusTime = alert.time;
      await this.app.setSymbol(alert.symbol);
      this.app.navigate('chart');
    },

    /** Asks for pop-up permission and unlocks sound, then says clearly what actually happened. */
    async enableAlerts() {
      this.sound.unlock();
      if ('Notification' in globalThis && Notification.permission === 'default') await Notification.requestPermission();
      const popupsOn = 'Notification' in globalThis && Notification.permission === 'granted';
      this.renderStatus();
      if (popupsOn) toast('Sound and pop-ups are on.');
      else toast('Sound is on, but the browser blocked pop-ups. Allow them in the address bar.', 'error');
    },

    /** Runs the real delivery path so the trader can confirm sound and pop-ups before relying on them. */
    testAlert() {
      this.sound.unlock();
      const played = this.sound.play();
      const popupsOn = 'Notification' in globalThis && Notification.permission === 'granted';
      if (popupsOn) new Notification('Test alert', { body: 'Alerts are working on this computer.' });
      toast(`Test: sound ${played ? 'played' : 'blocked, click once and retry'}, pop-up ${popupsOn ? 'sent' : 'not allowed'}.`, played && popupsOn ? 'success' : 'error');
    },

    handleClick(event) {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const { action } = target.dataset;
      if (action === 'enable-alerts') this.enableAlerts();
      if (action === 'test-alert') this.testAlert();
      if (action === 'open-alert') this.openOnChart(this.log[Number(target.dataset.position)]);
      if (action === 'clear-log') {
        this.log = [];
        APA.storage.writeJson(LOG_KEY, this.log);
        this.renderLog();
      }
    },

    /** Saves ticked markets and concepts as soon as they change. */
    handleChange(event) {
      const { alerts } = this.app.settings;
      const input = event.target;
      if (input.dataset.concept) alerts.concepts[input.dataset.concept] = input.checked;
      if (input.dataset.market) alerts.symbols = $$('[data-market]:checked', this.section).map((box) => box.dataset.market);
      APA.settings.save(this.app.settings);
    },
  };

  APA.views = APA.views || {};
  APA.views.alerts = view;
})((globalThis.APA = globalThis.APA || {}));
