import { describe, expect, test } from 'vitest';
import { PERSISTENCE, WINDOW_SIZE, analyzeSession } from './anomaly';
import { EXERCISE_END, expectedHr, phaseAt } from './baseline';
import { generateSession } from './generator';
import type { Sample } from './types';

/** Builds consecutive windows; each entry is the bpm offset of one window, or null for no contact. */
function session(offsets: Array<number | null>): Sample[] {
  return offsets.flatMap((offset, w) =>
    Array.from({ length: WINDOW_SIZE }, (_, i): Sample => {
      const t = w * WINDOW_SIZE + i;
      const contact = offset !== null;
      return {
        t,
        phase: phaseAt(t),
        contact,
        hr: contact ? expectedHr(t) + offset : null,
        skinTemp: contact ? 33.4 : null,
        spectral: contact ? [0.2] : null,
        motion: 0.05,
      };
    }),
  );
}

describe('analyzeSession', () => {
  test('returns one result per full window', () => {
    const results = analyzeSession(session([0, 0, 0]));
    expect(results).toHaveLength(3);
    expect(results[1].tStart).toBe(10);
    expect(results[1].tEnd).toBe(19);
  });

  test('keeps readings on the baseline within pattern', () => {
    for (const r of analyzeSession(session([0, 0, 0, 0]))) {
      expect(r.state).toBe('within-pattern');
      expect(r.deviating).toBe(false);
    }
  });

  test('does not flag a deviation that lasts fewer windows than required', () => {
    const results = analyzeSession(session([0, 20, 20, 0]));
    expect(results.map((r) => r.deviating)).toEqual([false, true, true, false]);
    expect(results.every((r) => r.state === 'within-pattern')).toBe(true);
  });

  test('flags a deviation once it persists', () => {
    const results = analyzeSession(session([0, 20, 20, 20, 20]));
    expect(results.map((r) => r.state)).toEqual([
      'within-pattern',
      'within-pattern',
      'within-pattern',
      'change-to-verify',
      'change-to-verify',
    ]);
    expect(results[3].streak).toBe(PERSISTENCE);
    expect(results[3].score).toBeCloseTo(5);
  });

  test('flags persistent readings below the baseline too', () => {
    const results = analyzeSession(session([-20, -20, -20]));
    expect(results[2].state).toBe('change-to-verify');
    expect(results[2].score).toBeCloseTo(-5);
  });

  test('never scores an unreliable window and restarts the streak', () => {
    const results = analyzeSession(session([20, 20, null, 20, 20]));
    expect(results[2].state).toBe('insufficient-data');
    expect(results[2].score).toBeNull();
    expect(results[2].streak).toBe(0);
    expect(results[4].streak).toBe(2);
    expect(results.some((r) => r.state === 'change-to-verify')).toBe(false);
  });
});

describe('scenarios', () => {
  test('usual recovery never raises an alert or loses data', () => {
    const results = analyzeSession(generateSession('usual'));
    expect(results).toHaveLength(30);
    expect(results.every((r) => r.state === 'within-pattern')).toBe(true);
  });

  test('misplaced sensor reports insufficient data and no deviation alert', () => {
    const results = analyzeSession(generateSession('misplaced'));
    const insufficient = results.filter((r) => r.state === 'insufficient-data');
    expect(insufficient.map((r) => r.tStart)).toEqual([170, 180, 190, 200, 210, 220, 230]);
    expect(insufficient.slice(0, 5).every((r) => r.quality.reason === 'no-contact')).toBe(true);
    expect(insufficient.slice(5).every((r) => r.quality.reason === 'motion')).toBe(true);
    expect(results.some((r) => r.state === 'change-to-verify')).toBe(false);
  });

  test('atypical recovery raises an alert only after it persists', () => {
    const results = analyzeSession(generateSession('atypical'));
    const first = results.find((r) => r.state === 'change-to-verify');
    expect(first?.tStart).toBe(180);
    expect(results.filter((r) => r.tStart < EXERCISE_END).every((r) => !r.deviating)).toBe(true);
    expect(results.filter((r) => r.tStart >= 180).every((r) => r.state === 'change-to-verify')).toBe(true);
  });
});
