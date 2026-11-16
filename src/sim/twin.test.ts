import { describe, expect, test } from 'vitest';
import { channelScores } from '../ml/channels';
import storedModel from '../ml/model.json';
import { predict } from '../ml/network';
import type { Model } from '../ml/network';
import { generateSession } from './generator';
import { BAND_LIMIT, DEAD_BAND, GAP_BYTES, HR_STEP, RAW_WINDOW_BYTES, RESIDUAL_BYTES, createTwin, encodeWindow, recordBytes } from './twin';

const model = storedModel as Model;
const score = (hr: number, skinTemp: number, zHr: number, zTemp: number) => ({ residual: { hr, skinTemp }, z: { hr: zHr, skinTemp: zTemp } });

describe('encodeWindow', () => {
  test('sends nothing for a window the ground can predict', () => {
    expect(encodeWindow(3, score(0.8, 0.01, 1.5, 0.3))).toBeNull();
  });

  test('sends the quantized residual once either signal leaves the dead band', () => {
    expect(encodeWindow(3, score(7.3, 0.11, 4, 3))).toEqual({ kind: 'residual', w: 3, hr: 15, temp: 6 });
    expect(encodeWindow(3, score(0.2, 0.09, 0.1, DEAD_BAND))).toMatchObject({ kind: 'residual' });
  });

  test('reports an unreliable window as a gap, never as a value', () => {
    expect(encodeWindow(9, null)).toEqual({ kind: 'gap', w: 9 });
  });

  test('clamps a residual that does not fit in one byte', () => {
    expect(encodeWindow(0, score(500, -9, 99, -99))).toMatchObject({ hr: 127, temp: -127 });
  });

  test('a record is far smaller than the raw window', () => {
    expect(recordBytes({ kind: 'residual', w: 0, hr: 1, temp: 1 })).toBe(RESIDUAL_BYTES);
    expect(recordBytes({ kind: 'gap', w: 0 })).toBe(GAP_BYTES);
    expect(RAW_WINDOW_BYTES / RESIDUAL_BYTES).toBe(20);
  });

  test('a normal session needs few windows sent; an atypical one needs more', () => {
    const sent = (tau?: number) =>
      channelScores(generateSession('usual', { seed: 30_001, vary: true, recoveryTau: tau }), model).filter(
        (item, index) => encodeWindow(index, item) !== null,
      ).length;
    expect(sent()).toBeLessThan(10);
    expect(sent(140)).toBeGreaterThan(sent());
  });
});

describe('createTwin', () => {
  const expected = (w: number) => predict(model.layers, w * 10 + 5).hr;

  test('rebuilds a reported window from the prediction plus the residual', () => {
    const twin = createTwin(model);
    twin.apply({ kind: 'residual', w: 4, hr: 12, temp: 0 });
    const estimate = twin.estimate(4);
    expect(estimate.basis).toBe('reported');
    expect(estimate.hr).toBeCloseTo(expected(4) + 12 * HR_STEP, 6);
  });

  test('a confirmed quiet window is the prediction itself', () => {
    const twin = createTwin(model);
    twin.confirm(5);
    expect(twin.estimate(2)).toMatchObject({ basis: 'predicted', hr: expected(2) });
  });

  test('a gap stays a gap', () => {
    const twin = createTwin(model);
    twin.apply({ kind: 'gap', w: 1 });
    twin.confirm(5);
    expect(twin.estimate(1)).toEqual({ w: 1, basis: 'gap', hr: null, low: null, high: null });
  });

  test('without news the band widens, up to a limit', () => {
    const twin = createTwin(model);
    twin.confirm(5);
    const width = (w: number) => {
      const estimate = twin.estimate(w);
      return (estimate.high! - estimate.low!) / (2 * model.spread.hr[w]);
    };
    expect(twin.estimate(6).basis).toBe('projected');
    expect(width(6)).toBeGreaterThan(DEAD_BAND);
    expect(width(12)).toBeGreaterThan(width(6));
    expect(width(29)).toBeCloseTo(BAND_LIMIT, 6);
  });

  test('carries the last reported residual into the projection', () => {
    const twin = createTwin(model);
    twin.apply({ kind: 'residual', w: 5, hr: 20, temp: 0 });
    twin.confirm(5);
    expect(twin.estimate(6).hr).toBeCloseTo(expected(6) + 20 * HR_STEP, 6);
  });

  test('news that arrives late replaces the projection', () => {
    const twin = createTwin(model);
    twin.confirm(2);
    expect(twin.estimate(8).basis).toBe('projected');
    twin.confirm(11);
    expect(twin.estimate(8).basis).toBe('predicted');
    expect(twin.confirmedThrough()).toBe(11);
  });
});