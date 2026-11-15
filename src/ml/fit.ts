import { DEVIATION_THRESHOLD, WINDOW_SIZE } from '../sim/anomaly';
import { SESSION_LENGTH } from '../sim/baseline';
import { generateSession } from '../sim/generator';
import type { Sample } from '../sim/types';
import { windowResiduals } from './detector';
import { contextFeatures, countParameters, encodeTarget } from './network';
import type { Model } from './network';
import { train } from './train';

/** Seed ranges never overlap, so no session is used for more than one purpose. */
export const SPLITS = {
  train: { firstSeed: 10_000, sessions: 200 },
  validation: { firstSeed: 20_000, sessions: 100 },
  test: { firstSeed: 30_000, sessions: 300 },
} as const;

const TRAINING = { hidden: [16, 16], epochs: 60, batchSize: 128, learningRate: 0.01, decay: 0.95, seed: 7 };
/** Smallest spread accepted, so a very quiet window position cannot blow up the score. */
const MIN_SPREAD = { hr: 1, skinTemp: 0.03 };

/** Normal sessions of the same person, each a little different from the last. */
export function referenceSessions(firstSeed: number, count: number, recoveryTau?: number): Sample[][] {
  return Array.from({ length: count }, (_, i) =>
    generateSession('usual', { seed: firstSeed + i, vary: true, recoveryTau }),
  );
}

const rootMeanSquare = (values: number[]) =>
  Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);

/** Trains the network on reference sessions and learns its spread from validation sessions. */
export function fitModel(): Model {
  const inputs: number[][] = [];
  const targets: number[][] = [];
  referenceSessions(SPLITS.train.firstSeed, SPLITS.train.sessions).forEach((session, s) => {
    // Every third sample, with a different offset per session, is plenty.
    for (let i = s % 3; i < session.length; i += 3) {
      const sample = session[i];
      if (sample.hr === null || sample.skinTemp === null) continue;
      inputs.push(contextFeatures(sample.t));
      targets.push(encodeTarget(sample.hr, sample.skinTemp));
    }
  });

  const { layers, loss } = train(inputs, targets, TRAINING);
  const model: Model = {
    layers,
    spread: { hr: [], skinTemp: [] },
    threshold: DEVIATION_THRESHOLD,
    training: {
      sessions: SPLITS.train.sessions,
      validationSessions: SPLITS.validation.sessions,
      epochs: TRAINING.epochs,
      parameters: countParameters(layers),
      loss,
    },
  };

  const validation = referenceSessions(SPLITS.validation.firstSeed, SPLITS.validation.sessions);
  for (let start = 0; start + WINDOW_SIZE <= SESSION_LENGTH; start += WINDOW_SIZE) {
    const residuals = validation.map((session) =>
      windowResiduals(session.slice(start, start + WINDOW_SIZE), model),
    );
    model.spread.hr.push(Math.max(MIN_SPREAD.hr, rootMeanSquare(residuals.map((r) => r.hr))));
    model.spread.skinTemp.push(
      Math.max(MIN_SPREAD.skinTemp, rootMeanSquare(residuals.map((r) => r.skinTemp))),
    );
  }
  return model;
}
