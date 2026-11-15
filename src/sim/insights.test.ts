import { describe, expect, test } from 'vitest';
import { analyzeSession } from './anomaly';
import { generateSession } from './generator';
import { sessionInsights } from './insights';
import type { Insight } from './insights';
import type { QueuedEvent, ScenarioId } from './types';

function insightsFor(scenario: ScenarioId, seconds = 300, events: QueuedEvent[] = []) {
  const samples = generateSession(scenario).slice(0, seconds);
  const byTitle = new Map<string, Insight>();
  for (const insight of sessionInsights(samples, analyzeSession(samples), events)) {
    byTitle.set(insight.title, insight);
  }
  return byTitle;
}

const queued = (stage: QueuedEvent['stage']): QueuedEvent => ({
  event: { id: 'evt-170', createdAt: 180, title: 'title', detail: 'detail' },
  stage,
  sentAt: null,
  receivedAt: null,
});

describe('sessionInsights', () => {
  test('asks for more data before the first window', () => {
    const insights = insightsFor('usual', 5);
    expect([...insights.keys()]).toEqual(['Not enough data']);
  });

  test('summarizes a usual recovery', () => {
    const insights = insightsFor('usual');
    expect(insights.get('Data reliability')).toMatchObject({ value: '100%' });
    expect(insights.get('Deviation from your pattern')?.value).toBe('No check needed');
    const peak = Number.parseInt(insights.get('Peak heart rate')!.value, 10);
    expect(peak).toBeGreaterThan(130);
    expect(peak).toBeLessThan(145);
    const recovery = Number.parseInt(insights.get('One-minute recovery')!.value, 10);
    expect(recovery).toBeGreaterThan(50);
    expect(insights.has('Ground link')).toBe(false);
  });

  test('reports a slower one-minute recovery and the requested check', () => {
    const insights = insightsFor('atypical');
    const recovery = Number.parseInt(insights.get('One-minute recovery')!.value, 10);
    expect(recovery).toBeLessThan(35);
    expect(insights.get('Deviation from your pattern')?.value).toBe('Check requested');
    expect(insights.get('Deviation from your pattern')?.detail).toContain('asked for a check at 03:10');
  });

  test('counts skipped windows and why they were skipped', () => {
    const reliability = insightsFor('misplaced').get('Data reliability')!;
    expect(reliability.value).toBe('77%');
    expect(reliability.detail).toContain('23 of 30 windows were usable');
    expect(reliability.detail).toContain('5 for no skin contact');
    expect(reliability.detail).toContain('2 for movement');
  });

  test('does not measure recovery from unreliable readings', () => {
    const recovery = insightsFor('misplaced').get('One-minute recovery')!;
    expect(recovery.value).toBe('—');
    expect(recovery.detail).toContain('not reliable enough');
  });

  test('says when the session has not reached one minute of recovery', () => {
    expect(insightsFor('usual', 180).get('One-minute recovery')?.detail).toContain('not reached');
  });

  test('describes events still waiting on board', () => {
    const link = insightsFor('atypical', 300, [queued('waiting')]).get('Ground link')!;
    expect(link.value).toBe('0 of 1 received');
    expect(link.detail).toContain('1 event is saved on board');
  });

  test('never mentions disease or diagnosis', () => {
    for (const scenario of ['usual', 'misplaced', 'atypical'] as const) {
      for (const insight of insightsFor(scenario, 300, [queued('received')]).values()) {
        expect(`${insight.title} ${insight.value} ${insight.detail}`.toLowerCase()).not.toMatch(
          /disease|diagnos|probab/,
        );
      }
    }
  });
});
