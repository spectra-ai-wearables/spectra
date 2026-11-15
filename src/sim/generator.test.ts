import { describe, expect, test } from 'vitest';
import { SESSION_LENGTH } from './baseline';
import { SPECTRAL_BANDS_NM, generateSession } from './generator';

describe('generateSession', () => {
  test('produces one sample per second for the whole session', () => {
    const samples = generateSession('usual');
    expect(samples).toHaveLength(SESSION_LENGTH);
    expect(samples.map((s) => s.t)).toEqual(
      Array.from({ length: SESSION_LENGTH }, (_, i) => i),
    );
  });

  test('is deterministic for the same scenario', () => {
    expect(generateSession('atypical')).toEqual(generateSession('atypical'));
  });

  test('differs between scenarios', () => {
    expect(generateSession('usual')).not.toEqual(generateSession('atypical'));
  });

  test('usual scenario always has contact and complete readings', () => {
    for (const s of generateSession('usual')) {
      expect(s.contact).toBe(true);
      expect(s.hr).not.toBeNull();
      expect(s.skinTemp).not.toBeNull();
      expect(s.spectral).toHaveLength(SPECTRAL_BANDS_NM.length);
    }
  });

  test('misplaced scenario loses contact between 170 s and 215 s', () => {
    const samples = generateSession('misplaced');
    for (const s of samples.slice(170, 215)) {
      expect(s.contact).toBe(false);
      expect(s.hr).toBeNull();
      expect(s.spectral).toBeNull();
    }
    expect(samples[169].contact).toBe(true);
    expect(samples[215].contact).toBe(true);
  });

  test('misplaced scenario has strong motion between 215 s and 240 s', () => {
    const samples = generateSession('misplaced');
    for (const s of samples.slice(215, 240)) {
      expect(s.motion).toBeGreaterThan(0.85);
    }
  });

  test('atypical scenario keeps heart rate elevated during recovery', () => {
    const usual = generateSession('usual')[200].hr as number;
    const atypical = generateSession('atypical')[200].hr as number;
    expect(atypical - usual).toBeGreaterThan(15);
  });
});
