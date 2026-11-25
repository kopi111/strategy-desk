"""RSI reversal + market structure on V100, V100(1s), V75 and V75(1s), with the same split and luck check.

Swing points: a swing high is the highest high of the k candles each side. It is only KNOWN k candles later,
and the rules below only use swings that are already known, so nothing sees the future.

Rules, fixed before any result was seen:
  * filter:  RSI reversal (buy RSI back above low level, sell back below high level) on 1H or 4H, taken only
             when structure agrees: last two known swing highs AND lows rising for a buy, falling for a sell.
             Stop 1 / 2 / 3 ATR, exit RR 1 / 2 / 3 or opposite signal.
  * bos15:   the 1H or 4H RSI reversal sets the direction for the next 2 of its candles. Entry when a 15m candle
             closes above the last known 15m swing high (buy) or below the last swing low (sell).
             Stop beyond the last 15m swing on the other side (structure stop) or 1 / 2 ATR(15m); RR 1 / 2 / 3.
Choose on the pooled t of period A (to 30 Jun 2026), score period B, then the same on shuffled prices.

Run:  python3 structure_search.py [shuffled_histories]     (default 20)
"""
import sys
from dataclasses import dataclass
from multiprocessing import Pool
from typing import Optional

import numpy as np
import pandas as pd

import ma_search
from ma_search import cost_per_trade, load_candles, pooled_t
from engine import CandleArrays, simulate
from rules import average_true_range, build_bars, relative_strength_index
from search import PERIOD_B_START, shuffled_candles

MARKETS = ("R_100", "1HZ100V", "R_75", "1HZ75V")
RSI_SETTINGS = ((14, 40, 60), (21, 40, 60), (7, 30, 70))
SIGNAL_MINUTES = (60, 240)
FILTER_SWING_SIZES = (2, 3, 5)
ENTRY_SWING_SIZES = (2, 3)
ATR_STOPS = (1.0, 2.0, 3.0)
TARGETS = (1.0, 2.0, 3.0, None)
ENTRY_STOPS = ("structure", 1.0, 2.0)
ENTRY_TARGETS = (1.0, 2.0, 3.0)
ENTRY_MINUTES = 15
BIAS_CANDLES = 2
MINIMUM_POOLED_TRADES_A = 150
SHUFFLED_HISTORIES = 20
SEED_BASE = 9100
WORKERS = 8
OUTPUT_FOLDER = ma_search.OUTPUT_FOLDER.parent / "output-structure"


@dataclass(frozen=True)
class Setting:
    """This class holds one RSI + structure strategy."""
    rule: str
    rsi: tuple
    minutes: int
    swing: int
    stop: object
    reward_risk: Optional[float]

    def label(self):
        """This function gives the setting a short readable name."""
        exit_name = "opposite signal" if self.reward_risk is None else f"RR {self.reward_risk:g}"
        stop_name = "structure stop" if self.stop == "structure" else f"stop {self.stop:g} ATR"
        rsi = f"RSI{self.rsi[0]} {self.rsi[1]}/{self.rsi[2]}"
        return f"{self.rule} {rsi} {self.minutes}m swing {self.swing} {stop_name} {exit_name}"


def every_setting():
    """This function lists every setting in a fixed order."""
    filters = [Setting("filter", rsi, minutes, swing, stop, target) for rsi in RSI_SETTINGS for minutes in SIGNAL_MINUTES
               for swing in FILTER_SWING_SIZES for stop in ATR_STOPS for target in TARGETS]
    entries = [Setting("bos15", rsi, minutes, swing, stop, target) for rsi in RSI_SETTINGS for minutes in SIGNAL_MINUTES
               for swing in ENTRY_SWING_SIZES for stop in ENTRY_STOPS for target in ENTRY_TARGETS]
    return filters + entries


def known_swings(bars, size):
    """This function returns, for each candle, the last two swing highs and lows that are already confirmed."""
    high, low = bars.high.to_numpy(), bars.low.to_numpy()
    window = 2 * size + 1
    is_high = pd.Series(high).rolling(window, center=True).max().to_numpy() == high
    is_low = pd.Series(low).rolling(window, center=True).min().to_numpy() == low
    count = len(high)
    last_highs, last_lows = np.full((count, 2), np.nan), np.full((count, 2), np.nan)
    highs, lows = [np.nan, np.nan], [np.nan, np.nan]
    for candle in range(count):
        swing = candle - size
        if swing >= 0 and is_high[swing]:
            highs = [highs[1], high[swing]]
        if swing >= 0 and is_low[swing]:
            lows = [lows[1], low[swing]]
        last_highs[candle], last_lows[candle] = highs, lows
    return last_highs, last_lows


def rsi_reversal(bars, period, low, high):
    """This function returns +1 where RSI turns up through the low level and -1 where it turns down through the high."""
    rsi = relative_strength_index(bars.close, period)
    buy = (rsi > low) & (rsi.shift(1) <= low)
    sell = (rsi < high) & (rsi.shift(1) >= high)
    return buy.fillna(False).to_numpy().astype(np.int8) - sell.fillna(False).to_numpy().astype(np.int8)


def structure_filtered(bars, setting):
    """This function keeps only the RSI signals that agree with the known swing structure."""
    signals = rsi_reversal(bars, *setting.rsi)
    highs, lows = known_swings(bars, setting.swing)
    bullish = (highs[:, 1] > highs[:, 0]) & (lows[:, 1] > lows[:, 0])
    bearish = (highs[:, 1] < highs[:, 0]) & (lows[:, 1] < lows[:, 0])
    return np.where(((signals > 0) & bullish) | ((signals < 0) & bearish), signals, 0).astype(np.int8)


def bias_on_entry_bars(signal_bars, entry_bars, signals, minutes):
    """This function spreads each higher-timeframe signal over the next BIAS_CANDLES of its candles on 15m bars."""
    bias = np.zeros(len(entry_bars), dtype=np.int8)
    closes = signal_bars.index + pd.Timedelta(minutes=minutes)
    for position in np.flatnonzero(signals):
        start = entry_bars.index.searchsorted(closes[position])
        end = entry_bars.index.searchsorted(closes[position] + pd.Timedelta(minutes=minutes * BIAS_CANDLES))
        bias[start:end] = signals[position]
    return bias


def structure_entries(entry_bars, bias, swing, stop, entry_atr):
    """This function enters on a 15m close through the last known swing in the bias direction and sets the risk."""
    highs, lows = known_swings(entry_bars, swing)
    close = entry_bars.close.to_numpy()
    previous_close = np.roll(close, 1)
    buy = (bias > 0) & (close > highs[:, 1]) & (previous_close <= highs[:, 1])
    sell = (bias < 0) & (close < lows[:, 1]) & (previous_close >= lows[:, 1])
    signals = buy.astype(np.int8) - sell.astype(np.int8)
    if stop == "structure":
        risk = np.where(signals > 0, close - lows[:, 1], np.where(signals < 0, highs[:, 1] - close, np.nan))
        risk = np.where(risk > 0, risk, np.nan)
    else:
        risk = stop * entry_atr
    return signals, risk


def period_statistics(results, in_period_b):
    """This function returns trade count, sum and sum of squares of R for period A and period B."""
    return [(len(results[mask]), results[mask].sum(), (results[mask] ** 2).sum()) for mask in (~in_period_b, in_period_b)]


def search_market(job):
    """This function plays every setting on one market and history and returns A/B statistics per setting."""
    market, seed = job
    candles = load_candles(market)
    if seed is not None:
        candles = shuffled_candles(candles, SEED_BASE * (seed + 1) + MARKETS.index(market))
    arrays, cost = CandleArrays.from_candles(candles), cost_per_trade(market, candles)
    split = int(np.searchsorted(candles.index.values, PERIOD_B_START.to_datetime64()))
    bars = {minutes: build_bars(candles, minutes) for minutes in SIGNAL_MINUTES + (ENTRY_MINUTES,)}
    atr = {minutes: average_true_range(frame).to_numpy() for minutes, frame in bars.items()}
    entry_bars = bars[ENTRY_MINUTES]
    statistics, cache = [], {}
    for setting in every_setting():
        if setting.rule == "filter":
            key = ("filter", setting.rsi, setting.minutes, setting.swing)
            if key not in cache:
                cache[key] = structure_filtered(bars[setting.minutes], setting)
            trades = simulate(arrays, bars[setting.minutes].first_candle.to_numpy(), cache[key], atr[setting.minutes],
                              setting.stop, setting.reward_risk, cost)
        else:
            key = ("bias", setting.rsi, setting.minutes)
            if key not in cache:
                cache[key] = bias_on_entry_bars(bars[setting.minutes], entry_bars,
                                                rsi_reversal(bars[setting.minutes], *setting.rsi), setting.minutes)
            signals, risk = structure_entries(entry_bars, cache[key], setting.swing, setting.stop, atr[ENTRY_MINUTES])
            trades = simulate(arrays, entry_bars.first_candle.to_numpy(), signals, risk, 1.0, setting.reward_risk, cost)
        statistics.append(period_statistics(trades.net_r, trades.entry >= split))
    return market, seed, np.array(statistics, dtype=float)


def main():
    """This function runs real and shuffled histories, chooses one setting per history and saves the tables."""
    shuffled_count = int(sys.argv[1]) if len(sys.argv) > 1 else SHUFFLED_HISTORIES
    seeds = [None] + list(range(shuffled_count))
    OUTPUT_FOLDER.mkdir(exist_ok=True)
    with Pool(WORKERS) as pool:
        results = pool.map(search_market, [(market, seed) for seed in seeds for market in MARKETS], chunksize=1)
    settings = every_setting()
    by_seed = {seed: {market: stats for market, s, stats in results if s == seed} for seed in seeds}
    real = by_seed[None]
    pooled = sum(real.values())
    table = pd.DataFrame({"setting": [setting.label() for setting in settings],
                          "trades_A": pooled[:, 0, 0], "net_R_A": pooled[:, 0, 1], "t_A": pooled_t(*pooled[:, 0, :].T),
                          "trades_B": pooled[:, 1, 0], "net_R_B": pooled[:, 1, 1], "t_B": pooled_t(*pooled[:, 1, :].T)})
    for market, stats in real.items():
        table[f"R_A_{market}"], table[f"R_B_{market}"] = stats[:, 0, 1], stats[:, 1, 1]
    table.to_csv(OUTPUT_FOLDER / "all_settings_real.csv", index=False)
    luck_rows = []
    for seed in seeds:
        pooled = sum(by_seed[seed].values())
        t_a = pooled_t(*pooled[:, 0, :].T)
        t_a[pooled[:, 0, 0] < MINIMUM_POOLED_TRADES_A] = -np.inf
        best = int(np.argmax(t_a))
        luck_rows.append({"seed": -1 if seed is None else seed, "setting": settings[best].label(), "t_A": t_a[best],
                          "net_R_A": pooled[best, 0, 1], "net_R_B": pooled[best, 1, 1],
                          "t_B": pooled_t(*pooled[:, 1, :].T)[best], "trades_B": int(pooled[best, 1, 0])})
        print(luck_rows[-1], flush=True)
    pd.DataFrame(luck_rows).to_csv(OUTPUT_FOLDER / "luck_table.csv", index=False)


if __name__ == "__main__":
    main()
