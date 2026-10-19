// Loads the browser scripts into Node in the same order index.html does, so tests run the real code.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CORE_SCRIPTS = [
  'js/core/storage.js', 'js/core/timeframes.js', 'js/core/instruments.js', 'js/core/settings.js',
  'js/core/candles.js', 'js/core/structure.js', 'js/core/zones.js', 'js/core/sessions.js',
  'js/core/engine.js', 'js/core/signal.js', 'js/core/performance.js', 'js/core/position-size.js', 'js/core/ml-model.js',
  'js/data/demo-feed.js', 'js/data/csv-feed.js',
];

export function loadCore() {
  for (const script of CORE_SCRIPTS) vm.runInThisContext(readFileSync(join(ROOT, script), 'utf8'), { filename: script });
  return globalThis.APA;
}
