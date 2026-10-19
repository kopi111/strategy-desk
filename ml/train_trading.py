"""Trains the hourly direction model, tests it year by year with spread costs, and exports it for the browser.

Question the model answers: from this hourly close, does price move 1 ATR up before 1 ATR down (within 24 hours)?
Run: ml/.venv/bin/python ml/train_trading.py
Writes: ml/output/report.json, ml/output/model.json (trees the dashboard evaluates on live candles)
"""
from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss, roc_auc_score

from trading_features import (BARRIER_ATR, FEATURES, HORIZON_BARS, LONG_HISTORY, SHORT_HISTORY_REAL,
                              SYNTHETICS, prepared)

OUTPUT_DIR = Path(__file__).parent / 'output'
FIRST_TEST_YEAR = 2019
SIGNAL_MARGIN = 0.06
SYNTHETIC_TRAIN_SHARE = 0.6


def new_model():
    return HistGradientBoostingClassifier(max_iter=200, learning_rate=0.03, max_leaf_nodes=15,
                                          min_samples_leaf=400, l2_regularization=1.0, random_state=7)


def decided(frame):
    return frame[frame['hit_upper'] >= 0]


def fit(train):
    rows = decided(train)
    return new_model().fit(rows[FEATURES], rows['hit_upper'])


def simulate(frame, probabilities):
    """One position per market at a time; long above 0.5 + margin, short below 0.5 - margin."""
    trades = []
    for symbol, rows in frame.assign(probability=probabilities).groupby('symbol', sort=False):
        busy_until = -1
        for row in rows.itertuples(index=False):
            if row.Index_in_symbol <= busy_until:
                continue
            direction = 1 if row.probability > 0.5 + SIGNAL_MARGIN else -1 if row.probability < 0.5 - SIGNAL_MARGIN else 0
            if direction == 0:
                continue
            trades.append({'symbol': symbol, 'r': direction * row.long_r - row.spread_r})
            busy_until = row.exit_index
    return pd.DataFrame(trades, columns=['symbol', 'r'])


def trade_summary(trades):
    if trades.empty:
        return {'trades': 0, 'net_r': 0.0, 'average_r': 0.0, 'win_rate': 0.0, 't_stat': 0.0}
    r = trades['r']
    standard_error = r.std(ddof=1) / np.sqrt(len(r)) if len(r) > 1 else np.nan
    return {'trades': int(len(r)), 'net_r': float(r.sum()), 'average_r': float(r.mean()),
            'win_rate': float((r > 0).mean()), 't_stat': float(r.mean() / standard_error) if standard_error else 0.0}


def score(test, probabilities):
    labelled = test['hit_upper'] >= 0
    actual = test.loc[labelled, 'hit_upper'].to_numpy()
    predicted = probabilities[labelled.to_numpy()]
    base_rate = np.full_like(predicted, actual.mean())
    trades = simulate(test, probabilities)
    return {'rows': int(labelled.sum()), 'up_first_rate': float(actual.mean()),
            'accuracy': float(((predicted > 0.5) == actual).mean()),
            'auc': float(roc_auc_score(actual, predicted)),
            'log_loss': float(log_loss(actual, predicted)), 'base_rate_log_loss': float(log_loss(actual, base_rate)),
            **trade_summary(trades),
            'by_symbol': {symbol: trade_summary(group) for symbol, group in trades.groupby('symbol')}}


def summarise_real(history):
    years, tests, probabilities = [], [], []
    for year in sorted(history['year'].unique()):
        if year < FIRST_TEST_YEAR:
            continue
        train, test = history[history['year'] < year], history[history['year'] == year]
        print(f'real markets {year}: train {len(train)} test {len(test)}')
        predicted = fit(train).predict_proba(test[FEATURES])[:, 1]
        years.append({'year': int(year), **score(test, predicted)})
        tests.append(test)
        probabilities.append(predicted)
    return {'years': years, 'all_test_years': score(pd.concat(tests), np.concatenate(probabilities))}


def time_split(history, share):
    cutoff = history['epoch'].quantile(share)
    return history[history['epoch'] <= cutoff], history[history['epoch'] > cutoff]


def summarise_synthetic(history):
    train, test = time_split(history, SYNTHETIC_TRAIN_SHARE)
    print(f'synthetics: train {len(train)} test {len(test)}')
    return score(test, fit(train).predict_proba(test[FEATURES])[:, 1])


def export_trees(model):
    trees = []
    for predictors in model._predictors:
        nodes = predictors[0].nodes
        trees.append([[int(node['feature_idx']), float(node['num_threshold']), int(node['left']), int(node['right']),
                       bool(node['missing_go_to_left']), bool(node['is_leaf']), float(node['value'])]
                      for node in nodes])
    return {'baseline': float(np.ravel(model._baseline_prediction)[0]), 'trees': trees}


def verdict(real):
    overall = real['all_test_years']
    if overall['net_r'] > 0 and overall['t_stat'] > 2:
        return 'The model made money after spread in testing (t > 2). Forward-test it before trusting it.'
    return (f"No tradable edge: {overall['trades']} test trades, {overall['net_r']:.1f}R after spread, "
            f"AUC {overall['auc']:.3f} (0.5 = coin flip). Treat its reading as context, not a signal.")


def load(symbols):
    return pd.concat([prepared(symbol).assign(Index_in_symbol=lambda frame: frame.index) for symbol in symbols],
                     ignore_index=True)


def main():
    real = load(list(LONG_HISTORY) + SHORT_HISTORY_REAL)
    synthetic = load(SYNTHETICS)
    real_summary = summarise_real(real)
    synthetic_summary = summarise_synthetic(synthetic)
    trained_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
    report = {'trained_at': trained_at, 'question': f'Does price move {BARRIER_ATR} ATR up before {BARRIER_ATR} ATR '
                                                    f'down within {HORIZON_BARS} hourly candles?',
              'signal_margin': SIGNAL_MARGIN, 'real_markets': real_summary, 'synthetics': synthetic_summary,
              'candles': {'real': int(len(real)), 'synthetic': int(len(synthetic))},
              'verdict': verdict(real_summary)}
    model_file = {'trained_at': trained_at, 'features': FEATURES, 'barrier_atr': BARRIER_ATR,
                  'horizon_bars': HORIZON_BARS, 'signal_margin': SIGNAL_MARGIN, 'verdict': report['verdict'],
                  'test': {'auc': real_summary['all_test_years']['auc'], 'net_r': real_summary['all_test_years']['net_r'],
                           'trades': real_summary['all_test_years']['trades'],
                           'synthetic_auc': synthetic_summary['auc'], 'synthetic_net_r': synthetic_summary['net_r']},
                  'models': {'real': export_trees(fit(real)), 'synthetic': export_trees(fit(synthetic))}}
    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / 'report.json').write_text(json.dumps(report, indent=1))
    (OUTPUT_DIR / 'model.json').write_text(json.dumps(model_file))
    print(json.dumps({key: value for key, value in real_summary['all_test_years'].items() if key != 'by_symbol'}, indent=1))
    print('synthetics', {key: value for key, value in synthetic_summary.items() if key != 'by_symbol'})
    print(report['verdict'])


if __name__ == '__main__':
    main()
