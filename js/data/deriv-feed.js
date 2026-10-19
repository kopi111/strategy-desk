(function (APA) {
  'use strict';

  const MAX_CANDLES_PER_REQUEST = 5000;
  const CONNECT_TIMEOUT_MS = 8000;
  const REQUEST_TIMEOUT_MS = 20000;
  const KEEPALIVE_MS = 30000;

  /**
   * Deriv's public WebSocket API (https://api.deriv.com). Candle history and live candles need no account and
   * no secret: app_id 1089 is Deriv's public test id. Covers the synthetic indices, XAUUSD and USD pairs.
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

    request(payload) {
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
        const wanted = Math.min(MAX_CANDLES_PER_REQUEST, count - collected.length);
        const answer = await this.request({ ticks_history: symbol, style: 'candles', granularity: seconds, count: wanted, end, adjust_start_time: 1 });
        const batch = (answer.candles || []).map(parseHistoryCandle).filter((candle) => !collected.length || candle.time < collected[0].time);
        collected = batch.concat(collected);
        if (batch.length < wanted) break;
        end = String(batch[0].time - 1);
      }
      return collected;
    }

    /** Calls onCandle with every update to the forming candle. Returns a function that stops the stream. */
    subscribe(symbol, seconds, onCandle) {
      let subscriptionId = null;
      let stopped = false;
      this.request({ ticks_history: symbol, style: 'candles', granularity: seconds, count: 1, end: 'latest', subscribe: 1 })
        .then((answer) => {
          subscriptionId = answer.subscription && answer.subscription.id;
          if (stopped) this.send({ forget: subscriptionId });
          else if (subscriptionId) this.streams.set(subscriptionId, onCandle);
        })
        .catch((error) => console.warn('[deriv] live stream failed', error));
      return () => {
        stopped = true;
        if (!subscriptionId) return;
        this.streams.delete(subscriptionId);
        this.send({ forget: subscriptionId });
      };
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
