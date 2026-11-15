/**
 * Trains the on-board model and evaluates it against the statistical baseline.
 * Writes src/ml/model.json and src/ml/evaluation.json. Run with `pnpm train`.
 */
import { writeFileSync } from 'node:fs';
import { evaluate } from '../src/ml/evaluate';
import { fitModel } from '../src/ml/fit';
import type { Model } from '../src/ml/network';

const round = (_key: string, value: unknown) =>
  typeof value === 'number' ? Number(value.toFixed(5)) : value;

// Evaluate the model exactly as it is stored, rounding included.
const model = JSON.parse(JSON.stringify(fitModel(), round)) as Model;
const evaluation = evaluate(model);

writeFileSync(new URL('../src/ml/model.json', import.meta.url), `${JSON.stringify(model)}\n`);
writeFileSync(
  new URL('../src/ml/evaluation.json', import.meta.url),
  `${JSON.stringify(evaluation, null, 2)}\n`,
);

console.log(`parameters: ${model.training.parameters}, training loss: ${model.training.loss}`);
console.log('spread hr:', model.spread.hr.join(' '));
console.table(
  evaluation.map((c) => ({
    case: c.label,
    tau: c.recoveryTau,
    sessions: c.sessions,
    'baseline alerts': c.baseline.alerts,
    'baseline delay': c.baseline.medianDelay,
    'model alerts': c.model.alerts,
    'model delay': c.model.medianDelay,
  })),
);
