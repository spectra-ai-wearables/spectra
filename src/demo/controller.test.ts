import { describe, expect, test } from 'vitest';
import { WINDOW_SIZE } from '../sim/anomaly';
import { SESSION_LENGTH } from '../sim/baseline';
import { DEFAULT_DELAY } from '../sim/link';
import { createDemo } from './controller';
import type { Demo } from './controller';

const run = (demo: Demo, steps: number) => {
  for (let i = 0; i < steps; i++) demo.step();
};

describe('createDemo', () => {
  test('starts paused at zero with nothing to show', () => {
    const view = createDemo('usual').view();
    expect(view).toMatchObject({
      scenario: 'usual',
      elapsed: 0,
      playing: false,
      finished: false,
      connected: true,
      latest: null,
      result: null,
      explanation: null,
    });
    expect(view.samples).toEqual([]);
    expect(view.events).toEqual([]);
  });

  test('reveals one sample per step', () => {
    const demo = createDemo('usual');
    run(demo, 25);
    const view = demo.view();
    expect(view.elapsed).toBe(25);
    expect(view.samples).toHaveLength(25);
    expect(view.latest?.t).toBe(24);
  });

  test('shows the most recently completed window', () => {
    const demo = createDemo('usual');
    run(demo, WINDOW_SIZE - 1);
    expect(demo.view().result).toBeNull();
    demo.step();
    expect(demo.view().result?.tStart).toBe(0);
    run(demo, WINDOW_SIZE + 3);
    expect(demo.view().result?.tStart).toBe(WINDOW_SIZE);
  });

  test('usual recovery finishes settled with no events', () => {
    const demo = createDemo('usual');
    run(demo, SESSION_LENGTH);
    const view = demo.view();
    expect(view.finished).toBe(true);
    expect(view.settled).toBe(true);
    expect(view.events).toEqual([]);
    expect(view.explanation?.label).toBe('Within your pattern');
  });

  test('misplaced sensor shows insufficient data and creates no event', () => {
    const demo = createDemo('misplaced');
    run(demo, 200);
    expect(demo.view().explanation?.label).toBe('Not enough reliable data');
    run(demo, 100);
    expect(demo.view().events).toEqual([]);
  });

  test('atypical recovery starts without a link', () => {
    expect(createDemo('atypical').view().connected).toBe(false);
  });

  test('atypical recovery queues one event and holds it while the link is down', () => {
    const demo = createDemo('atypical');
    run(demo, 189);
    expect(demo.view().events).toEqual([]);
    demo.step();
    expect(demo.view().explanation?.label).toBe('Change to verify');
    run(demo, SESSION_LENGTH - 190);
    const view = demo.view();
    expect(view.events).toHaveLength(1);
    expect(view.events[0].stage).toBe('waiting');
    expect(view.finished).toBe(true);
    expect(view.settled).toBe(false);
  });

  test('the held event reaches the ground after the link returns', () => {
    const demo = createDemo('atypical');
    run(demo, SESSION_LENGTH);
    demo.setConnected(true);
    expect(demo.view().events[0].stage).toBe('sending');
    run(demo, DEFAULT_DELAY);
    const view = demo.view();
    expect(view.events).toHaveLength(1);
    expect(view.events[0].stage).toBe('received');
    expect(view.settled).toBe(true);
    expect(view.elapsed).toBe(SESSION_LENGTH);
  });

  test('play and pause only change the playing flag', () => {
    const demo = createDemo('usual');
    demo.play();
    expect(demo.view().playing).toBe(true);
    demo.pause();
    expect(demo.view().playing).toBe(false);
    expect(demo.view().elapsed).toBe(0);
  });

  test('select restarts everything with the scenario defaults', () => {
    const demo = createDemo('atypical');
    run(demo, SESSION_LENGTH);
    demo.play();
    demo.select('usual');
    expect(demo.view()).toMatchObject({
      scenario: 'usual',
      elapsed: 0,
      playing: false,
      connected: true,
    });
    expect(demo.view().events).toEqual([]);
  });

  test('reset restarts the current scenario', () => {
    const demo = createDemo('atypical');
    run(demo, SESSION_LENGTH);
    demo.setConnected(true);
    demo.reset();
    expect(demo.view()).toMatchObject({ scenario: 'atypical', elapsed: 0, connected: false });
    expect(demo.view().events).toEqual([]);
  });
});
