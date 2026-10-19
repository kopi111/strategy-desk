(function (APA) {
  'use strict';

  /**
   * Historical OHLC from a CSV file the user loads. Needs columns for time and open/high/low/close (any order,
   * header row required). Time may be epoch seconds, epoch milliseconds or a date string. Higher timeframes are
   * built from the file's own candles, so load the entry timeframe (for example 5m) or lower.
   */
  class CsvFeed {
    constructor(fileName, text) {
      this.kind = 'csv';
      this.label = `CSV · ${fileName}`;
      this.base = parse(text);
      this.baseSeconds = detectTimeframe(this.base);
    }

    async connect() {}

    async candles(_symbol, seconds, count) {
      if (seconds < this.baseSeconds) {
        throw new Error(`The CSV holds ${this.baseSeconds / 60}-minute candles; it cannot supply ${seconds / 60}-minute ones.`);
      }
      const series = seconds === this.baseSeconds ? this.base : APA.candles.resample(this.base, seconds);
      return series.slice(-count);
    }

    subscribe() {
      return () => {};
    }
  }

  function parse(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 3) throw new Error('The CSV needs a header row and at least two candles.');
    const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(delimiter).map((name) => name.trim().toLowerCase().replace(/["<>]/g, ''));
    const column = (names) => header.findIndex((name) => names.includes(name));
    const columns = {
      time: column(['time', 'timestamp', 'date', 'datetime', 'epoch', 'open_time']),
      open: column(['open', 'o']), high: column(['high', 'h']), low: column(['low', 'l']), close: column(['close', 'c']),
    };
    const missing = Object.entries(columns).filter(([, index]) => index < 0).map(([name]) => name);
    if (missing.length) throw new Error(`The CSV header is missing: ${missing.join(', ')}.`);

    const candles = lines.slice(1).map((line, row) => toCandle(line.split(delimiter), columns, row + 2));
    candles.sort((first, second) => first.time - second.time);
    return candles.filter((candle, index) => index === 0 || candle.time !== candles[index - 1].time);
  }

  function toCandle(cells, columns, lineNumber) {
    const value = (name) => Number(String(cells[columns[name]]).replace(/"/g, '').trim());
    const candle = { time: parseTime(cells[columns.time], lineNumber), open: value('open'), high: value('high'), low: value('low'), close: value('close') };
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
      throw new Error(`Line ${lineNumber}: open/high/low/close must be numbers.`);
    }
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
      throw new Error(`Line ${lineNumber}: high/low do not contain the open and close.`);
    }
    return candle;
  }

  function parseTime(raw, lineNumber) {
    const text = String(raw).replace(/"/g, '').trim();
    if (/^\d+(\.\d+)?$/.test(text)) {
      const number = Number(text);
      return Math.floor(number > 1e11 ? number / 1000 : number);
    }
    const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
    if (Number.isNaN(parsed)) throw new Error(`Line ${lineNumber}: cannot read the time "${text}".`);
    return Math.floor(parsed / 1000);
  }

  function detectTimeframe(candles) {
    const gaps = [];
    for (let index = 1; index < Math.min(candles.length, 500); index++) gaps.push(candles[index].time - candles[index - 1].time);
    gaps.sort((first, second) => first - second);
    const median = gaps[Math.floor(gaps.length / 2)];
    const known = APA.timeframes.all.find((timeframe) => timeframe.seconds === median);
    if (!known) throw new Error(`Candles are ${median} seconds apart; use 1m, 5m, 15m, 1H, 4H or 1D data.`);
    return median;
  }

  APA.CsvFeed = CsvFeed;
})((globalThis.APA = globalThis.APA || {}));
