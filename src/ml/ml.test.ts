import { describe, expect, test } from 'vitest';
import { PERSISTENCE } from '../sim/anomaly';
import { EXERCISE_END, expectedHr } from '../sim/baseline';
import { generateSession } from '../sim/generator';
import { analyzeWithModel } from './detector';
import { evaluate } from './evaluate';
import storedEvaluation from './evaluation.json';
import { SPLITS } from './fit';
import storedModel from './model.json';
import { contextFeatures, countParameters, forward, predict } from './network';
import type { Layer, Model } from './network';
import { train } from './train';

const model = storedModel as Model;

describe('forward', () => {
  test('applies tanh on hidden layers and keeps the output linear', () => {
    const layers: Layer[] = [
      { weights: [[1, -1]], biases: [0.5] },
      { weights: [[2]], biases: [1] },
    ];
    expect(forward(layers, [1, 0.5])[0]).toBeCloseTo(2 * Math.tanh(1) + 1);
  });
});

describe('contextFeatures', () => {
  test('marks exactly one phase and the progress through it', () => {
    expect(contextFeatures(0)).toEqual([0, 1, 0, 0, 0]);
    expect(contextFeatures(105)).toEqual([0.35, 0, 1, 0, 0.5]);
    expect(contextFeatures(225)).toEqual([0.75, 0, 0, 1, 0.5]);
  });
});

describe('train', () => {
  const inputs = Array.from({ length: 200 }, (_, i) => [i / 100 - 1]);
  const targets = inputs.map(([x]) => [x * x]);
  const options = { hidden: [8], epochs: 150, batchSize: 20, learningRate: 0.02, decay: 0.99, seed: 1 };

  test('learns a curve from examples', () => {
    const { layers, loss } = train(inputs, targets, options);
    expect(loss).toBeLessThan(0.002);
    expect(forward(layers, [0.5])[0]).toBeCloseTo(0.25, 1);
  });

  test('is deterministic for the same seed', () => {
    expect(train(inputs, targets, options)).toEqual(train(inputs, targets, options));
  });
});

describe('stored model', () => {
  test('records its real size', () => {
    expect(model.training.parameters).toBe(countParameters(model.layers));
    expect(model.spread.hr).toHaveLength(30);
    expect(model.spread.skinTemp).toHaveLength(30);
  });

  test('learned the recovery curve without being given it', () => {
    for (const t of [30, 100, 149, 160, 200, 290]) {
      expect(Math.abs(predict(model.layers, t).hr - expectedHr(t))).toBeLessThan(3);
    }
  });

  test('usual recovery raises no alert', () => {
    const results = analyzeWithModel(generateSession('usual'), model);
    expect(results).toHaveLength(30);
    expect(results.every((r) => r.state === 'within-pattern')).toBe(true);
  });

  test('misplaced sensor is never scored while unreliable and raises no alert', () => {
    const results = analyzeWithModel(generateSession('misplaced'), model);
    const insufficient = results.filter((r) => r.state === 'insufficient-data');
    expect(insufficient.map((r) => r.tStart)).toEqual([170, 180, 190, 200, 210, 220, 230]);
    expect(insufficient.every((r) => r.score === null)).toBe(true);
    expect(results.some((r) => r.state === 'change-to-verify')).toBe(false);
  });

  test('atypical recovery raises an alert during recovery, only after it persists', () => {
    const results = analyzeWithModel(generateSession('atypical'), model);
    const first = results.find((r) => r.state === 'change-to-verify');
    expect(first).toBeDefined();
    expect(first!.streak).toBe(PERSISTENCE);
    expect(first!.tStart).toBeGreaterThanOrEqual(EXERCISE_END);
    expect(first!.deviationBpm).toBeGreaterThan(10);
    expect(results.filter((r) => r.tStart < EXERCISE_END).every((r) => !r.deviating)).toBe(true);
  });
});

describe('evaluation', () => {
  test('uses seeds that do not overlap training or validation', () => {
    const end = (split: { firstSeed: number; sessions: number }) => split.firstSeed + split.sessions;
    expect(end(SPLITS.train)).toBeLessThanOrEqual(SPLITS.validation.firstSeed);
    expect(end(SPLITS.validation)).toBeLessThanOrEqual(SPLITS.test.firstSeed);
  });

  test('the published numbers are what the stored model produces', () => {
    expect(evaluate(model)).toEqual(storedEvaluation);
  });
});
