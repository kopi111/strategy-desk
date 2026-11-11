(function (APA) {
  'use strict';

  // APA with the SETUP on 15m and the CONFIRMATION candle on 5m.
  // Same rules as research/apa-15m-5m-confirm/backtest_mtf.py (tests/apa-confirm.test.mjs checks they agree):
  //   1. 15m setup: after a structure break, a candle sweeps the invalidation level and closes back inside.
  //      It is only known once that 15m candle has closed.
  //   2. Wait up to 3 more 15m candles for a 5m candle in the trade's colour that closes past the last confirmed
  //      5m swing (5m change of character). Cancelled if a 5m candle closes past the sweep candle's far end.
  //   3. Entry = that 5m close. Stop = sweep extreme + ATR buffer. Target = RR x risk, live from the next 5m candle.

  const SETUP_SECONDS = 900;
  const CONFIRM_SECONDS = 300;
  const SETUP_SWING = 5;
  const CONFIRM_SWING = 3;
  const WINDOW_SETUP_CANDLES = 3;
  const ATR_LENGTH = 14;
  const CANDLES_NEEDED = { setup: 600, confirm: 1800 };

  // The two tested versions (gold, Oct 2023 - Sep 2026, spread charged). Neither is proven.
  const MODES = {
    profit: { label: 'Most profit (2R)', rr: 2, stopAtr: 0.5, proof: 'Gold backtest: 126 trades, 43.7% wins, +35.3R in 3 years. Unproven; lost on forex and Vix.' },
    winRate: { label: '60% wins (0.75R)', rr: 0.75, stopAtr: 1.0, proof: 'Gold backtest: 138 trades, 60.9% wins, only +5.5R in 3 years (about break-even). Lost on forex and Vix.' },
  };

  /** Swing highs/lows, each set on the candle that confirms it (n candles later), like ta.pivothigh/pivotlow. */
  function pivots(candles, n) {
    const highs = new Array(candles.length).fill(null);
    const lows = new Array(candles.length).fill(null);
    for (let index = 2 * n; index < candles.length; index++) {
      const centre = index - n;
      const high = candles[centre].high;
      const low = candles[centre].low;
      let isHigh = true;
      let isLow = true;
      for (let other = centre - n; other <= index; other++) {
        if (other === centre) continue;
        const after = other > centre;
        // After the centre the swing must be strictly beyond; before it, equal is allowed.
        if (after ? candles[other].high >= high : candles[other].high > high) isHigh = false;
        if (after ? candles[other].low <= low : candles[other].low < low) isLow = false;
      }
      if (isHigh) highs[index] = high;
      if (isLow) lows[index] = low;
    }
    return { highs, lows };
  }

  /** Every 15m sweep setup, with the time it becomes known (the close of its candle). */
  function findSetups(candles) {
    const { highs, lows } = pivots(candles, SETUP_SWING);
    let lastHigh = null; let lastLow = null; let bullLevel = null; let bearLevel = null;
    let bullActive = false; let bearActive = false;
    const setups = [];
    for (let index = 1; index < candles.length; index++) {
      const candle = candles[index];
      const previousClose = candles[index - 1].close;
      // Structure: the newest confirmed swing high and low.
      if (highs[index] !== null) lastHigh = highs[index];
      if (lows[index] !== null) lastLow = lows[index];
      const bullBreak = lastHigh !== null && candle.close > lastHigh && previousClose <= lastHigh;
      const bearBreak = lastLow !== null && candle.close < lastLow && previousClose >= lastLow;
      // A break sets the invalidation level at the opposite swing.
      if (bullBreak && lastLow !== null) { bullLevel = lastLow; bullActive = true; bearActive = false; }
      if (bearBreak && lastHigh !== null) { bearLevel = lastHigh; bearActive = true; bullActive = false; }
      // The sweep: a wick through the level and a close back inside. Each level is used once.
      const knownAt = candle.time + SETUP_SECONDS;
      if (bullActive && candle.low < bullLevel && candle.close > bullLevel) {
        setups.push({ time: candle.time, knownAt, side: 1, high: candle.high, low: candle.low, level: bullLevel });
        bullActive = false;
      } else if (bearActive && candle.high > bearLevel && candle.close < bearLevel) {
        setups.push({ time: candle.time, knownAt, side: -1, high: candle.high, low: candle.low, level: bearLevel });
        bearActive = false;
      }
      // A full close through the level ends the structure.
      if (bullActive && candle.close < bullLevel) bullActive = false;
      if (bearActive && candle.close > bearLevel) bearActive = false;
    }
    return setups;
  }

  /** 14-candle average true range for each candle (null until there are enough candles). */
  function averageTrueRange(candles) {
    const ranges = candles.map((candle, index) => {
      const previousClose = index ? candles[index - 1].close : candle.close;
      return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
    });
    let total = 0;
    return ranges.map((range, index) => {
      total += range - (index >= ATR_LENGTH ? ranges[index - ATR_LENGTH] : 0);
      return index >= ATR_LENGTH - 1 ? total / ATR_LENGTH : null;
    });
  }

  /** Where a stop or target was hit inside one candle, using TradingView's open-high-low-close path rule. */
  function exitOnCandle(side, candle, stop, target) {
    const { open, high, low } = candle;
    const highFirst = (high - open) < (open - low);
    if (side > 0) {
      if (open <= stop) return { price: open, why: 'stop' };
      if (open >= target) return { price: open, why: 'target' };
      if (highFirst) {
        if (high >= target) return { price: target, why: 'target' };
        if (low <= stop) return { price: stop, why: 'stop' };
      } else {
        if (low <= stop) return { price: stop, why: 'stop' };
        if (high >= target) return { price: target, why: 'target' };
      }
    } else {
      if (open >= stop) return { price: open, why: 'stop' };
      if (open <= target) return { price: open, why: 'target' };
      if (highFirst) {
        if (high >= stop) return { price: stop, why: 'stop' };
        if (low <= target) return { price: target, why: 'target' };
      } else {
        if (low <= target) return { price: target, why: 'target' };
        if (high >= stop) return { price: stop, why: 'stop' };
      }
    }
    return null;
  }

  /** A 5m candle in the trade's colour closing past the last confirmed 5m swing. */
  function confirms(side, candle, swingHigh, swingLow) {
    if (side > 0) return candle.close > candle.open && swingHigh !== null && candle.close > swingHigh;
    return candle.close < candle.open && swingLow !== null && candle.close < swingLow;
  }

  /**
   * Replays the 5m candles against the 15m setups. Returns the closed trades, every event for the chart,
   * and what is happening now: a setup waiting for confirmation, an open trade, or nothing.
   */
  function replay(confirmCandles, setups, { rr, stopAtr, spread = 0, minimumRisk = 1e-9 }) {
    const { highs, lows } = pivots(confirmCandles, CONFIRM_SWING);
    const atr = averageTrueRange(confirmCandles);
    let swingHigh = null; let swingLow = null; let nextSetup = 0; let pending = null; let trade = null;
    const trades = [];
    const events = [];
    for (let index = 1; index < confirmCandles.length; index++) {
      const candle = confirmCandles[index];
      // 1) The open trade: stop and target are live from the candle after entry.
      if (trade) {
        const exit = exitOnCandle(trade.side, candle, trade.stop, trade.target);
        if (exit) {
          const grossR = (exit.price - trade.entry) * trade.side / trade.risk;
          const closed = { ...trade, exitTime: candle.time, exit: exit.price, why: exit.why, grossR, netR: grossR - spread / trade.risk };
          trades.push(closed);
          events.push({ kind: 'exit', time: candle.time, side: trade.side, netR: closed.netR });
          trade = null;
        }
      }
      // 2) 15m setups whose candle closed by the start of this 5m candle.
      while (nextSetup < setups.length && setups[nextSetup].knownAt <= candle.time) {
        const setup = setups[nextSetup++];
        events.push({ kind: 'setup', time: setup.knownAt, side: setup.side, price: setup.side > 0 ? setup.low : setup.high, taken: !trade && !pending });
        if (!trade && !pending) {
          pending = { ...setup, extreme: setup.side > 0 ? setup.low : setup.high, expires: setup.knownAt + WINDOW_SETUP_CANDLES * SETUP_SECONDS };
        }
      }
      // 3) The waiting setup: expire, cancel, or confirm with this candle.
      if (pending && !trade) {
        const side = pending.side;
        if (candle.time >= pending.expires) {
          events.push({ kind: 'expired', time: candle.time, side });
          pending = null;
        } else {
          pending.extreme = side > 0 ? Math.min(pending.extreme, candle.low) : Math.max(pending.extreme, candle.high);
          const cancelled = side > 0 ? candle.close < pending.low : candle.close > pending.high;
          if (cancelled) {
            events.push({ kind: 'cancelled', time: candle.time, side });
            pending = null;
          } else if (confirms(side, candle, swingHigh, swingLow)) {
            let stop = pending.extreme;
            if (stopAtr && atr[index] !== null) stop -= side * stopAtr * atr[index];
            const risk = (candle.close - stop) * side;
            if (risk > minimumRisk) {
              trade = { side, entryTime: candle.time, entry: candle.close, stop, risk, target: candle.close + side * rr * risk, setupTime: pending.time };
              events.push({ kind: 'entry', time: candle.time, side, price: candle.close });
            }
            pending = null;
          }
        }
      }
      // 4) Newest confirmed 5m swing, used from the next candle on.
      if (highs[index] !== null) swingHigh = highs[index];
      if (lows[index] !== null) swingLow = lows[index];
    }
    const waiting = pending ? { ...pending, confirmAbove: swingHigh, confirmBelow: swingLow } : null;
    return { trades, events, open: trade, waiting };
  }

  /** What to show now, in plain words: an open trade, a setup waiting for its 5m candle, or nothing. */
  function stateFrom(result) {
    if (result.open) return { status: 'open', ...result.open };
    if (result.waiting) {
      const waiting = result.waiting;
      const buying = waiting.side > 0;
      return { status: 'waiting', side: waiting.side, cancelAt: buying ? waiting.low : waiting.high,
        confirmAt: buying ? waiting.confirmAbove : waiting.confirmBelow, expires: waiting.expires, setupTime: waiting.time };
    }
    return { status: 'none' };
  }

  /** Fetches closed 15m and 5m candles for one market and works out the signals. */
  async function forMarket(market, instrument, mode = 'profit', nowSeconds = Math.floor(Date.now() / 1000)) {
    const settings = MODES[mode] || MODES.profit;
    const closed = async (seconds, count) => APA.candles.closedOnly(await market.chartCandles(instrument.symbol, seconds, count), seconds, nowSeconds);
    const setupCandles = await closed(SETUP_SECONDS, CANDLES_NEEDED.setup);
    const confirmCandles = await closed(CONFIRM_SECONDS, CANDLES_NEEDED.confirm);
    if (!setupCandles.length || !confirmCandles.length) return { state: { status: 'none' }, events: [], trades: [], settings, error: 'Deriv sent no candles.' };
    const result = replay(confirmCandles, findSetups(setupCandles),
      { rr: settings.rr, stopAtr: settings.stopAtr, spread: instrument.spread || 0, minimumRisk: Math.pow(10, -(instrument.decimals ?? 5)) });
    return { state: stateFrom(result), events: result.events, trades: result.trades, settings };
  }

  APA.apaConfirm = { MODES, SETUP_SECONDS, CONFIRM_SECONDS, pivots, findSetups, replay, stateFrom, forMarket, exitOnCandle };
})((globalThis.APA = globalThis.APA || {}));
