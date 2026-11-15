import { describe, expect, test } from 'vitest';
import {
  BASELINE_SIGMA,
  EXERCISE_END,
  RESTING_HR,
  REST_END,
  SESSION_LENGTH,
  baselineAt,
  expectedHr,
  phaseAt,
} from './baseline';

describe('phaseAt', () => {
  test('splits the session into rest, exercise and recovery', () => {
    expect(phaseAt(0)).toBe('rest');
    expect(phaseAt(REST_END - 1)).toBe('rest');
    expect(phaseAt(REST_END)).toBe('exercise');
    expect(phaseAt(EXERCISE_END - 1)).toBe('exercise');
    expect(phaseAt(EXERCISE_END)).toBe('recovery');
    expect(phaseAt(SESSION_LENGTH - 1)).toBe('recovery');
  });
});

describe('expectedHr', () => {
  test('stays at the resting rate during rest', () => {
    expect(expectedHr(0)).toBe(RESTING_HR);
    expect(expectedHr(REST_END - 1)).toBe(RESTING_HR);
  });

  test('rises during exercise and approaches the exercise rate', () => {
    expect(expectedHr(REST_END + 10)).toBeGreaterThan(RESTING_HR + 20);
    expect(expectedHr(EXERCISE_END - 1)).toBeGreaterThan(130);
    expect(expectedHr(EXERCISE_END - 1)).toBeLessThan(135);
  });

  test('is continuous where exercise ends', () => {
    const before = expectedHr(EXERCISE_END - 0.001);
    const after = expectedHr(EXERCISE_END);
    expect(Math.abs(before - after)).toBeLessThan(0.1);
  });

  test('returns close to rest by the end of the session', () => {
    expect(expectedHr(SESSION_LENGTH)).toBeLessThan(RESTING_HR + 2);
  });

  test('recovers more slowly with a larger time constant', () => {
    expect(expectedHr(200, 140)).toBeGreaterThan(expectedHr(200) + 15);
  });
});

describe('baselineAt', () => {
  test('centers a band of three sigmas on the expected rate', () => {
    const band = baselineAt(100);
    expect(band.expected).toBe(expectedHr(100));
    expect(band.high - band.expected).toBeCloseTo(3 * BASELINE_SIGMA);
    expect(band.expected - band.low).toBeCloseTo(3 * BASELINE_SIGMA);
  });
});
