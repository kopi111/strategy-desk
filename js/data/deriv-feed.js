(function (APA) {
  'use strict';

  const MAX_CANDLES_PER_REQUEST = 5000;
  const CONNECT_TIMEOUT_MS = 8000;
  const REQUEST_TIMEOUT_MS = 20000;
  const KEEPALIVE_MS = 30000;
  const POLL_INTERVAL_MS = 10000;
  // Asked for one candle, Deriv returns a rolling window with a sliding start time, not the forming candle.
  // Asking for two or more returns proper candles, so a one-candle request asks for two and keeps the newest.
  const MINIMUM_CANDLES_REQUESTED = 2;

  /**
   * Deriv's public WebSocket API (https://api.deriv.com). Candle history and live candles need no account and
   * no secret: app_id 1089 is Deriv's public test id. Covers the synthetic indices, XAUUSD and USD pairs.
   * That public id refuses live streaming ("Symbol X is invalid"), so live candles fall back to polling.
   */
  class DerivFeed {
    constructor({ endpoint, appId }) {
      this.kind = 'live';
      this.label = 'Deriv live';
      this.url = `${endpoint}?app_id=${encodeURIComponent(appId)}`;
      this.socket = null;
      this.nextRequestId = 1;
      this.pending = new Map();
      this.streams = new Map();
      this.keepalive = null;
      this.requestQueue = Promise.resolve();
      this.streamingRefused = false;
    }

    connect() {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(this.url);
        const timer = setTimeout(() => { socket.close(); reject(new Error('Deriv did not answer within 8 seconds.')); }, CONNECT_TIMEOUT_MS);
        socket.onopen = () => {
          clearTimeout(timer);
          this.socket = socket;
          this.keepalive = setInterval(() => this.send({ ping: 1 }), KEEPALIVE_MS);
          resolve();
        };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('Could not open a connection to Deriv.')); };
        socket.onclose = () => this.handleClose();
        socket.onmessage = (message) => this.dispatch(JSON.parse(message.data));
      });
    }

    handleClose() {
      clearInterval(this.keepalive);
      this.socket = null;
      for (const { reject } of this.pending.values()) reject(new Error('Connection to Deriv closed.'));
      this.pending.clear();
    }

    dispatch(message) {
      if (message.msg_type === 'ohlc' && message.subscription) {
        const handler = this.streams.get(message.subscription.id);
        if (handler) handler(parseStreamCandle(message.ohlc));
        return;
      }
      const waiting = this.pending.get(message.req_id);
      if (!waiting) return;
      this.pending.delete(message.req_id);
      clearTimeout(waiting.timer);
      if (message.error) waiting.reject(new Error(`Deriv: ${message.error.message}`));
      else waiting.resolve(message);
    }

    send(payload) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
    }

    /** Queues a request. Deriv can silently drop requests sent at the same time, so only one runs at once. */
    request(payload) {
      const run = () => this.sendAndWait(payload);
      const result = this.requestQueue.then(run, run);
      // A failed request must not block the ones behind it. Its caller still receives the failure through `result`.
      this.requestQueue = result.catch(() => {});
      return result;
    }

    /** Sends one request and waits for its answer. A closed connection fails straight away. */
    sendAndWait(payload) {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Connection to Deriv closed.'));
      const requestId = this.nextRequestId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          reject(new Error('Deriv took too long to answer.'));
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(requestId, { resolve, reject, timer });
        this.send({ ...payload, req_id: requestId });
      });
    }

    /** Newest `count` candles, paging backwards 5,000 at a time. The last one may still be forming. */
    async candles(symbol, seconds, count) {
      await this.connect();
      let collected = [];
      let end = 'latest';
      while (collected.length < count) {
        const wanted = Math.max(MINIMUM_CANDLES_REQUESTED, Math.min(MAX_CANDLES_PER_REQUEST, count - collected.length));
        const answer = await this.request({ ticks_history: symbol, style: 'candles', granularity: seconds, count: wanted, end, adjust_start_time: 1 });
        const batch = (answer.candles || []).map(parseHistoryCandle).filter((candle) => !collected.length || candle.time < collected[0].time);
        collected = batch.concat(collected);
        if (batch.length < wanted) break;
        end = String(batch[0].time - 1);
      }
      return collected.slice(-count);
    }

    /** Calls onCandle with every update to the forming candle. Returns a function that stops the stream. */
    subscribe(symbol, seconds, onCandle) {
      if (this.streamingRefused) return this.pollCandles(symbol, seconds, onCandle);
      let subscriptionId = null;
      let stopped = false;
      let stopPolling = null;
      this.request({ ticks_history: symbol, style: 'candles', granularity: seconds, count: 1, end: 'latest', subscribe: 1 })
        .then((answer) => {
          subscriptionId = answer.subscription && answer.subscription.id;
          if (stopped) this.send({ forget: subscriptionId });
          else if (subscriptionId) this.streams.set(subscriptionId, onCandle);
        })
        .catch((error) => {
          // Remember the refusal, so later charts skip straight to polling.
          console.warn('[deriv] live stream refused, polling instead', error);
          this.streamingRefused = true;
          if (!stopped) stopPolling = this.pollCandles(symbol, seconds, onCandle);
        });
      return () => {
        stopped = true;
        if (stopPolling) stopPolling();
        if (!subscriptionId) return;
        this.streams.delete(subscriptionId);
        this.send({ forget: subscriptionId });
      };
    }

    /** Asks for the newest candle on a timer. It reconnects by itself if the connection dropped. */
    pollCandles(symbol, seconds, onCandle) {
      let stopped = false;
      const poll = async () => {
        try {
          const [latest] = await this.candles(symbol, seconds, 1);
          if (latest && !stopped) onCandle(latest);
        } catch (error) {
          console.warn('[deriv] candle poll failed, will retry', error);
        }
      };
      poll();
      const timer = setInterval(poll, POLL_INTERVAL_MS);
      return () => { stopped = true; clearInterval(timer); };
    }
  }

  function parseHistoryCandle(candle) {
    return { time: Number(candle.epoch), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) };
  }

  function parseStreamCandle(ohlc) {
    return { time: Number(ohlc.open_time), open: Number(ohlc.open), high: Number(ohlc.high), low: Number(ohlc.low), close: Number(ohlc.close) };
  }

  APA.DerivFeed = DerivFeed;
})((globalThis.APA = globalThis.APA || {}));
