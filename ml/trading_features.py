"""Hourly candle features and labels. js/core/ml-model.js computes the same features in the browser:
change one, change both, then run ml/check_parity.mjs."""
from pathlib import Path

import numpy as np
import pandas as pd

CACHE = Path.home() / 'projects/deriv_signal_app/research/cache'
LONG_HISTORY = {'frxXAUUSD': 'xauusd', 'frxEURUSD': 'eurusd', 'frxGBPUSD': 'gbpusd',
                'frxAUDUSD': 'audusd', 'frxUSDJPY': 'usdjpy', 'frxUSDCAD': 'usdcad'}
SHORT_HISTORY_REAL = ['frxNZDUSD', 'frxUSDCHF']
SYNTHETICS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ75V', '1HZ100V', 'stpRNG']
SPREADS = {'frxXAUUSD': 0.3, 'frxUSDJPY': 0.012, 'R_10': 0.6, 'R_25': 1.2, 'R_50': 0.05, 'R_75': 25,
           'R_100': 0.4, '1HZ75V': 2, '1HZ100V': 0.4, 'stpRNG': 0.1}
DEFAULT_FX_SPREAD = 0.00012

BARRIER_ATR = 1.0
HORIZON_BARS = 24
WARMUP_BARS = 200
RETURN_LAGS = [1, 4, 12, 24, 72]
FEATURES = ([f'return_{lag}' for lag in RETURN_LAGS] +
            ['atr_ratio', 'rsi', 'from_high_24', 'from_low_24', 'from_high_120', 'from_low_120',
             'from_sma_20', 'from_sma_50', 'from_sma_200', 'body', 'upper_wick', 'lower_wick',
             'hour', 'weekday'])


def spread_of(symbol):
    return SPREADS.get(symbol, DEFAULT_FX_SPREAD)


def read_long(name):
    frame = pd.read_csv(CACHE / 'long' / f'{name}.csv')
    frame['epoch'] = (frame['timestamp'] // 1000).astype('int64')
    return frame[['epoch', 'open', 'high', 'low', 'close']]


def read_cached(symbol):
    frame = pd.read_csv(CACHE / f'{symbol}_1h.csv')
    frame['epoch'] = frame['epoch'].astype('int64')
    return frame[['epoch', 'open', 'high', 'low', 'close']]


def load_candles(symbol):
    frame = read_long(LONG_HISTORY[symbol]) if symbol in LONG_HISTORY else read_cached(symbol)
    frame = frame.drop_duplicates('epoch').sort_values('epoch').reset_index(drop=True)
    return frame[frame['epoch'] % 3600 == 0].reset_index(drop=True)


def true_range(frame):
    previous_close = frame['close'].shift(1)
    ranges = pd.concat([frame['high'] - frame['low'], (frame['high'] - previous_close).abs(),
                        (frame['low'] - previous_close).abs()], axis=1)
    return ranges.max(axis=1)


def simple_rsi(close, length=14):
    change = close.diff()
    gains = change.clip(lower=0).rolling(length).mean()
    losses = (-change).clip(lower=0).rolling(length).mean()
    return 100 - 100 / (1 + gains / losses.replace(0, np.nan))


def add_features(frame):
    close = frame['close']
    tr = true_range(frame)
    atr = tr.rolling(14).mean()
    frame['atr'] = atr
    for lag in RETURN_LAGS:
        frame[f'return_{lag}'] = (close - close.shift(lag)) / atr
    frame['atr_ratio'] = atr / tr.rolling(100).mean()
    frame['rsi'] = simple_rsi(close)
    for window in (24, 120):
        frame[f'from_high_{window}'] = (frame['high'].rolling(window).max() - close) / atr
        frame[f'from_low_{window}'] = (close - frame['low'].rolling(window).min()) / atr
    for window in (20, 50, 200):
        frame[f'from_sma_{window}'] = (close - close.rolling(window).mean()) / atr
    frame['body'] = (close - frame['open']) / atr
    frame['upper_wick'] = (frame['high'] - frame[['open', 'close']].max(axis=1)) / atr
    frame['lower_wick'] = (frame[['open', 'close']].min(axis=1) - frame['low']) / atr
    moments = pd.to_datetime(frame['epoch'], unit='s', utc=True)
    frame['hour'] = moments.dt.hour
    frame['weekday'] = moments.dt.weekday
    return frame


def long_trade_outcome(highs, lows, closes, entry_index, atr):
    """R multiple of a long opened at the close of entry_index: +1 at the upper barrier, -1 at the lower
    barrier (a bar touching both counts as the stop), otherwise the close after HORIZON_BARS."""
    entry = closes[entry_index]
    last = min(entry_index + HORIZON_BARS, len(closes) - 1)
    for index in range(entry_index + 1, last + 1):
        if lows[index] <= entry - BARRIER_ATR * atr:
            return -1.0, index, 0
        if highs[index] >= entry + BARRIER_ATR * atr:
            return 1.0, index, 1
    return (closes[last] - entry) / (BARRIER_ATR * atr), last, -1


def add_labels(frame):
    highs, lows, closes, atrs = (frame[column].to_numpy() for column in ('high', 'low', 'close', 'atr'))
    outcomes = [long_trade_outcome(highs, lows, closes, index, atrs[index]) if np.isfinite(atrs[index])
                else (np.nan, index, -1) for index in range(len(frame))]
    frame['long_r'], frame['exit_index'], frame['hit_upper'] = map(list, zip(*outcomes))
    frame = frame.iloc[:len(frame) - HORIZON_BARS]
    return frame


def prepared(symbol):
    frame = add_labels(add_features(load_candles(symbol)))
    frame['symbol'] = symbol
    frame['year'] = pd.to_datetime(frame['epoch'], unit='s', utc=True).dt.year
    frame['spread_r'] = spread_of(symbol) / (BARRIER_ATR * frame['atr'])
    return frame.iloc[WARMUP_BARS:].reset_index(drop=True)
