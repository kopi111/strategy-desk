"""Writes ml/output/parity.json: recent candles plus the features and probabilities Python computes for them."""
import json
from pathlib import Path

import numpy as np

from trading_features import FEATURES, add_features, load_candles
from train_trading import export_trees, fit, prepared

SAMPLES = 40
WINDOW = 300


def main():
    model = fit(prepared('frxXAUUSD'))
    candles = add_features(load_candles('frxXAUUSD')).tail(WINDOW + SAMPLES).reset_index(drop=True)
    expected = candles.iloc[WINDOW:]
    payload = {'model': export_trees(model),
               'candles': [{'time': int(row.epoch), 'open': row.open, 'high': row.high, 'low': row.low, 'close': row.close}
                           for row in candles.itertuples()],
               'window': WINDOW,
               'features': np.where(np.isfinite(expected[FEATURES].to_numpy(float)), expected[FEATURES].to_numpy(float), None).tolist(),
               'probabilities': model.predict_proba(expected[FEATURES])[:, 1].tolist()}
    (Path(__file__).parent / 'output' / 'parity.json').write_text(json.dumps(payload))


if __name__ == '__main__':
    main()
