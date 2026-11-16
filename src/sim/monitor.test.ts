import { describe, expect, test } from 'vitest';
import { analyzeWithModel } from '../ml/detector';
import { SPLITS, referenceSessions } from '../ml/fit';
import storedModel from '../ml/model.json';
import type { Model } from '../ml/network';
import { windowCause } from './cause';
import { generateSession } from './generator';
import { correlate } from './incidents';
import type { Alert } from './incidents';
import { CLEAR_WINDOWS, CUSUM_SLACK, CUSUM_WARN, cusumSeries, runMonitor } from './monitor';
import type { Quality, WindowResult } from './types';

const model = storedModel as Model;
const good: Quality = { reliable: true, reason: 'ok', usable: 1 };

function results(scores: Array<number | null>): WindowResult[] {
  let streak = 0;
  return scores.map((score, index) => {
    const deviating = score !== null && Math.abs(score) >= 3;
    streak = deviating ? streak + 1 : 0;
    return {
      tStart: index * 10,
      tEnd: index * 10 + 9,
      phase: 'rest',
      quality: score === null ? { reliable: false, reason: 'motion', usable: 1 } : good,
      score,
      deviationBpm: score,
      deviating,
      streak,
      state: score === null ? 'insufficient-data' : streak >= 3 ? 'change-to-verify' : 'within-pattern',
    };
  });
}

const states = (scores: Array<number | null>) => runMonitor(results(scores)).map((step) => step.state);

describe('runMonitor', () => {
  test('stays ok while nothing deviates', () => {
    expect(states([0.2, -0.5, 1, 0])).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  test('warns on a deviating window and alerts once it persists', () => {
    const steps = runMonitor(results([0, 4, 4, 4, 4]));
    expect(steps.map((step) => step.state)).toEqual(['ok', 'warn', 'warn', 'alert', 'alert']);
    expect(steps.map((step) => step.raised)).toEqual([false, false, false, true, false]);
  });

  test('steps down only after several calm windows', () => {
    const calm = Array<number>(CLEAR_WINDOWS).fill(0);
    expect(states([4, 0, 0, 4, ...calm])).toEqual(['warn', 'warn', 'warn', 'warn', 'warn', 'warn', 'ok']);
  });

  test('an unreliable window shows no data and does not clear the alert behind it', () => {
    expect(states([4, 4, 4, null, 4])).toEqual(['warn', 'warn', 'alert', 'no-data', 'alert']);
    expect(runMonitor(results([4, 4, 4, null, 4])).filter((step) => step.raised)).toHaveLength(1);
  });

  test('adds up small deviations that share a direction', () => {
    const sums = cusumSeries(results([2.5, 2.5, 2.5, null, -2.5]));
    expect(sums[0]).toBeCloseTo(2.5 - CUSUM_SLACK, 6);
    expect(sums[2]).toBeCloseTo(3 * (2.5 - CUSUM_SLACK), 6);
    expect(sums[3]).toBe(sums[2]);
    expect(sums[4]).toBeLessThan(sums[2]);
  });

  test('holds a warning from the trend alone, without raising an alert', () => {
    const steps = runMonitor(results([2.8, 2.8, 2.8, 2.8, 2.8, 2.8]));
    expect(steps.at(-1)).toMatchObject({ state: 'warn', trending: true, raised: false });
    expect(steps.at(-1)!.cusum).toBeGreaterThanOrEqual(CUSUM_WARN);
  });

  test('on held-out normal sessions: no alert, and the trend warns in 4 of 300', () => {
    const sessions = referenceSessions(SPLITS.test.firstSeed, SPLITS.test.sessions).map((session) => analyzeWithModel(session, model));
    expect(sessions.filter((session) => runMonitor(session).some((step) => step.raised))).toHaveLength(0);
    expect(sessions.filter((session) => Math.max(...cusumSeries(session)) >= CUSUM_WARN)).toHaveLength(4);
  });

  test('on sessions drifting 3 bpm per minute: always alerts, and the trend is ahead in 72 of 100', () => {
    let alerted = 0;
    let ahead = 0;
    for (let i = 0; i < 100; i++) {
      const session = analyzeWithModel(generateSession('usual', { seed: 40_000 + i, vary: true, slowDrift: { from: 30, bpmPerMinute: 3 } }), model);
      const trend = cusumSeries(session).findIndex((sum) => sum >= CUSUM_WARN);
      const persistence = session.findIndex((result) => result.state === 'change-to-verify');
      if (persistence >= 0) alerted += 1;
      if (trend >= 0 && (persistence < 0 || trend < persistence)) ahead += 1;
    }
    expect(alerted).toBe(100);
    expect(ahead).toBe(72);
  });
});

describe('windowCause', () => {
  const z = (hr: number, skinTemp: number) => ({ residual: { hr, skinTemp }, z: { hr, skinTemp } });

  test('blames movement or the sensor for an unreliable window', () => {
    expect(windowCause(null, { reliable: false, reason: 'motion', usable: 1 }, 0, 4)).toBe('movement');
    expect(windowCause(null, { reliable: false, reason: 'no-contact', usable: 0 }, 0, 4)).toBe('sensor');
  });

  test('points at the cabin when most of the crew deviates together', () => {
    expect(windowCause(z(5, 4), good, 3, 4)).toBe('environment');
    expect(windowCause(z(5, 4), good, 2, 4)).toBe('physiological');
  });

  test('points at the sensor when only the optical reading moved', () => {
    expect(windowCause(z(6, 0.4), good, 1, 4)).toBe('sensor');
  });

  test('points at the body when heart rate and skin temperature moved together', () => {
    expect(windowCause(z(6, 5), good, 1, 4)).toBe('physiological');
  });
});

describe('correlate', () => {
  const alert = (crew: string, createdAt: number, cause: Alert['cause']): Alert => ({ id: `${crew}-${createdAt}`, crew, createdAt, cause, title: '', detail: '' });

  test('folds a cabin-wide burst into one incident and counts what it suppressed', () => {
    const incidents = correlate([alert('CDR', 210, 'environment'), alert('MS2', 200, 'environment'), alert('PLT', 220, 'environment')]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ crew: ['MS2', 'CDR', 'PLT'], suppressed: 2, firstAt: 200, lastAt: 220 });
  });

  test('keeps different people apart when the cause is individual', () => {
    expect(correlate([alert('CDR', 200, 'physiological'), alert('PLT', 205, 'physiological')])).toHaveLength(2);
  });

  test('keeps different causes apart', () => {
    expect(correlate([alert('CDR', 200, 'sensor'), alert('CDR', 210, 'physiological')])).toHaveLength(2);
  });

  test('repeats from one person merge only while they are close in time', () => {
    expect(correlate([alert('CDR', 100, 'physiological'), alert('CDR', 150, 'physiological')])).toHaveLength(1);
    expect(correlate([alert('CDR', 100, 'physiological'), alert('CDR', 200, 'physiological')])).toHaveLength(2);
  });
});