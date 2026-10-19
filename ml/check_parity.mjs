// Fails if the browser model (js/core/ml-model.js) disagrees with Python on features or probabilities.
// Run: ml/.venv/bin/python ml/export_parity.py && node ml/check_parity.mjs
import { readFileSync } from 'node:fs';
import { loadCore } from '../tests/load-core.mjs';

const TOLERANCE = 1e-6;
const APA = loadCore();
const parity = JSON.parse(readFileSync(new URL('./output/parity.json', import.meta.url), 'utf8'));
let worstFeature = 0;
let worstProbability = 0;

parity.probabilities.forEach((expectedProbability, sample) => {
  const end = parity.window + sample;
  const window = parity.candles.slice(end + 1 - APA.mlModel.CANDLES_NEEDED, end + 1);
  const vector = APA.mlModel.features(window);
  parity.features[sample].forEach((expected, index) => {
    const actual = vector[index];
    const gap = expected === null ? (Number.isFinite(actual) ? Infinity : 0) : Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
    worstFeature = Math.max(worstFeature, gap);
  });
  worstProbability = Math.max(worstProbability, Math.abs(APA.mlModel.probabilityUp(parity.model, vector) - expectedProbability));
});

console.log(`samples ${parity.probabilities.length}, worst feature gap ${worstFeature.toExponential(2)}, worst probability gap ${worstProbability.toExponential(2)}`);
if (worstFeature > TOLERANCE || worstProbability > TOLERANCE) process.exit(1);
