import { describe, expect, test } from 'vitest';
import { STATE_LABELS, explain, toEvent } from './explain';
import type { QualityReason, WindowResult } from './types';

function result(overrides: Partial<WindowResult> = {}): WindowResult {
  return {
    tStart: 180,
    tEnd: 189,
    phase: 'recovery',
    quality: { reliable: true, reason: 'ok', usable: 1 },
    score: 0,
    deviating: false,
    streak: 0,
    state: 'within-pattern',
    ...overrides,
  };
}

const unreliable = (reason: QualityReason) =>
  result({
    quality: { reliable: false, reason, usable: 0 },
    score: null,
    state: 'insufficient-data',
  });

describe('explain', () => {
  test('uses the exact state labels', () => {
    expect(STATE_LABELS).toEqual({
      'within-pattern': 'Within your pattern',
      'change-to-verify': 'Change to verify',
      'insufficient-data': 'Not enough reliable data',
    });
  });

  test('describes a normal recovery', () => {
    const e = explain(result());
    expect(e.label).toBe('Within your pattern');
    expect(e.detail).toContain('recovery pattern');
    expect(e.action).toBe('No action needed.');
  });

  test('says it is watching a deviation that has not persisted yet', () => {
    const e = explain(result({ score: 4, deviating: true, streak: 1 }));
    expect(e.label).toBe('Within your pattern');
    expect(e.detail).toContain('watching');
  });

  test('explains a persistent deviation with direction, size and duration', () => {
    const e = explain(result({ score: 5, deviating: true, streak: 3, state: 'change-to-verify' }));
    expect(e.label).toBe('Change to verify');
    expect(e.detail).toContain('above');
    expect(e.detail).toContain('20 bpm');
    expect(e.detail).toContain('30 seconds');
    expect(e.detail).toContain('Signal quality is good');
    expect(e.action).toContain('Confirm the measurement');
  });

  test('reports readings below the pattern as below', () => {
    const e = explain(result({ score: -5, deviating: true, streak: 3, state: 'change-to-verify' }));
    expect(e.detail).toContain('below');
  });

  test('asks to adjust the band when contact is lost', () => {
    const e = explain(unreliable('no-contact'));
    expect(e.label).toBe('Not enough reliable data');
    expect(e.action).toContain('Adjust the band');
  });

  test('asks to hold still when motion interferes', () => {
    expect(explain(unreliable('motion')).action).toContain('still');
  });

  test('asks to repeat when readings are missing', () => {
    expect(explain(unreliable('missing-data')).action).toContain('repeat the measurement');
  });

  test('never mentions disease or diagnosis', () => {
    const texts = [
      explain(result()),
      explain(result({ score: 5, deviating: true, streak: 3, state: 'change-to-verify' })),
      explain(unreliable('no-contact')),
    ].flatMap((e) => [e.label, e.detail, e.action]);
    for (const text of texts) {
      expect(text.toLowerCase()).not.toMatch(/disease|diagnos|probab/);
    }
  });
});

describe('toEvent', () => {
  test('builds an event stamped after the window closes', () => {
    const r = result({ score: 5, deviating: true, streak: 3, state: 'change-to-verify' });
    const event = toEvent(r, explain(r));
    expect(event.id).toBe('evt-180');
    expect(event.createdAt).toBe(190);
    expect(event.title).toBe('Heart rate outside recovery pattern');
    expect(event.detail).toBe(explain(r).detail);
  });
});
