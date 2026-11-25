"""Measures a list of trades: profit, risk, consistency and how they ranked for selection."""
import math

import numpy as np

CANDLES_PER_DAY = 288
DAYS_PER_YEAR = 365
TIME_SLICES = 4
REGIME_CODES = (0, 1, 2)
MINIMUM_TRADES_FOR_T = 2


def t_value(results):
    """How many standard errors the average trade sits from zero; about 2 or more is notable for ONE test."""
    if len(results) < MINIMUM_TRADES_FOR_T:
        return 0.0
    deviation = results.std(ddof=1)
    return float(results.mean() / deviation * math.sqrt(len(results))) if deviation > 0 else 0.0


def longest_run(flags):
    """The longest unbroken stretch of True values, used for winning and losing streaks."""
    padded = np.concatenate(([False], flags, [False])).astype(np.int8)
    edges = np.flatnonzero(np.diff(padded))
    return int((edges[1::2] - edges[::2]).max()) if len(edges) else 0


def max_drawdown(results):
    """The largest drop from a previous high in cumulative R."""
    equity = np.concatenate(([0.0], results.cumsum()))
    return float((np.maximum.accumulate(equity) - equity).max())


def annual_sharpe(trades, first_candle, end_candle):
    """Risk-adjusted return from daily R totals, counting days with no trade as zero."""
    day_count = max(int((end_candle - first_candle) / CANDLES_PER_DAY), 1)
    days = np.clip((trades.entry - first_candle) // CANDLES_PER_DAY, 0, day_count - 1)
    daily_results = np.bincount(days, weights=trades.net_r, minlength=day_count)
    deviation = daily_results.std(ddof=1) if day_count > 1 else 0.0
    return float(daily_results.mean() / deviation * math.sqrt(DAYS_PER_YEAR)) if deviation > 0 else 0.0


def full_metrics(trades, first_candle, end_candle):
    """Every figure the report needs for one strategy over one stretch of time."""
    results = trades.net_r
    wins, losses = results[results > 0], results[results <= 0]
    lost_total = -losses.sum()
    average_win = float(wins.mean()) if len(wins) else 0.0
    average_loss = float(losses.mean()) if len(losses) else 0.0
    return {"trades": len(results),
            "win_rate": float(len(wins) / len(results) * 100) if len(results) else 0.0,
            "profit_factor": float(wins.sum() / lost_total) if lost_total > 0 else 0.0,
            "net_r": float(results.sum()),
            "max_drawdown_r": max_drawdown(results),
            "average_win_r": average_win,
            "average_loss_r": average_loss,
            "reward_risk": average_win / -average_loss if average_loss < 0 else 0.0,
            "expectancy_r": float(results.mean()) if len(results) else 0.0,
            "sharpe": annual_sharpe(trades, first_candle, end_candle),
            "t": t_value(results),
            "longest_win_streak": longest_run(results > 0),
            "longest_loss_streak": longest_run(results <= 0),
            "cost_r": float(trades.cost_r.sum()),
            "net_r_double_cost": float((results - trades.cost_r).sum())}


def positive_share(trades, regimes, first_candle, end_candle):
    """Fraction of checks that made money: four equal time slices plus the bull, bear and sideways regimes."""
    results = trades.net_r
    edges = np.linspace(first_candle, end_candle, TIME_SLICES + 1)
    slices = np.clip(np.digitize(trades.entry, edges) - 1, 0, TIME_SLICES - 1)
    slice_totals = np.bincount(slices, weights=results, minlength=TIME_SLICES)
    entry_regimes = regimes[trades.entry]
    regime_totals = [results[entry_regimes == code].sum() for code in REGIME_CODES]
    profitable_checks = int((slice_totals > 0).sum()) + sum(total > 0 for total in regime_totals)
    return profitable_checks / (TIME_SLICES + len(REGIME_CODES))


def robustness_score(trades, regimes, first_candle, end_candle):
    """The ranking number: statistical strength, discounted when the profit is not spread across conditions."""
    return t_value(trades.net_r) * positive_share(trades, regimes, first_candle, end_candle)


def regime_totals(trades, regimes):
    """Total R earned when the market was bull, bear or sideways at the moment of entry."""
    results, entry_regimes = trades.net_r, regimes[trades.entry]
    names = {0: "sideways", 1: "bull", 2: "bear"}
    return {name: float(results[entry_regimes == code].sum()) for code, name in names.items()}
