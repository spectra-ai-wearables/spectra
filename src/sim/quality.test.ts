import { describe, expect, test } from 'vitest';
import { assessQuality } from './quality';
import type { Sample } from './types';

function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    t: 0,
    phase: 'rest',
    contact: true,
    hr: 62,
    skinTemp: 33.4,
    spectral: [0.2, 0.3],
    motion: 0.05,
    ...overrides,
  };
}

const windowOf = (count: number, overrides: Partial<Sample> = {}) =>
  Array.from({ length: count }, () => sample(overrides));

describe('assessQuality', () => {
  test('accepts a clean window', () => {
    expect(assessQuality(windowOf(10))).toEqual({ reliable: true, reason: 'ok', usable: 1 });
  });

  test('accepts the motion level of normal exercise', () => {
    expect(assessQuality(windowOf(10, { motion: 0.6 })).reliable).toBe(true);
  });

  test('rejects a window that lost skin contact', () => {
    const window = [
      ...windowOf(5),
      ...windowOf(5, { contact: false, hr: null, skinTemp: null, spectral: null }),
    ];
    expect(assessQuality(window)).toEqual({ reliable: false, reason: 'no-contact', usable: 0.5 });
  });

  test('rejects a window with too many missing readings', () => {
    const window = [...windowOf(7), ...windowOf(3, { hr: null })];
    expect(assessQuality(window)).toEqual({ reliable: false, reason: 'missing-data', usable: 0.7 });
  });

  test('rejects a window dominated by motion', () => {
    const result = assessQuality(windowOf(10, { motion: 0.95 }));
    expect(result.reliable).toBe(false);
    expect(result.reason).toBe('motion');
  });

  test('treats an empty window as missing data', () => {
    expect(assessQuality([])).toEqual({ reliable: false, reason: 'missing-data', usable: 0 });
  });
});
