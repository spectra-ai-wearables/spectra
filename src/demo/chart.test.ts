import { describe, expect, test } from 'vitest';
import { SESSION_LENGTH } from '../sim/baseline';
import type { Sample } from '../sim/types';
import { CHART, PHASE_MARKS, bandPath, linePath, xAt, yAt } from './chart';

const sample = (t: number, hr: number | null): Sample => ({
  t,
  phase: 'rest',
  contact: hr !== null,
  hr,
  skinTemp: null,
  spectral: null,
  motion: 0,
});

describe('scales', () => {
  test('map the session onto the plot area', () => {
    expect(xAt(0)).toBe(CHART.left);
    expect(xAt(SESSION_LENGTH)).toBe(CHART.width - CHART.right);
    expect(yAt(CHART.minHr)).toBe(CHART.height - CHART.bottom);
    expect(yAt(CHART.maxHr)).toBe(CHART.top);
  });

  test('clamp heart rates outside the axis', () => {
    expect(yAt(500)).toBe(CHART.top);
    expect(yAt(0)).toBe(CHART.height - CHART.bottom);
  });
});

describe('linePath', () => {
  test('is empty without samples', () => {
    expect(linePath([])).toBe('');
  });

  test('draws one continuous line through valid readings', () => {
    const d = linePath([sample(0, 60), sample(1, 61), sample(2, 62)]);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.match(/L/g)).toHaveLength(2);
  });

  test('breaks the line where readings are missing', () => {
    const d = linePath([sample(0, 60), sample(1, 61), sample(2, null), sample(3, 62), sample(4, 63)]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/L/g)).toHaveLength(2);
  });
});

describe('bandPath', () => {
  test('is a closed shape', () => {
    const d = bandPath();
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('PHASE_MARKS', () => {
  test('marks the three phases in order', () => {
    expect(PHASE_MARKS.map((m) => m.label)).toEqual(['Rest', 'Exercise', 'Recovery']);
    expect(PHASE_MARKS.map((m) => m.t)).toEqual([0, 60, 150]);
  });
});
