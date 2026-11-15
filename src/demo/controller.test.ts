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
      baseline: null,
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
    run(demo, 179);
    expect(demo.view().events).toEqual([]);
    demo.step();
    expect(demo.view().explanation?.label).toBe('Change to verify');
    run(demo, SESSION_LENGTH - 180);
    const view = demo.view();
    expect(view.events).toHaveLength(1);
    expect(view.events[0].stage).toBe('waiting');
    expect(view.finished).toBe(true);
    expect(view.settled).toBe(false);
  });

  test('shows the statistical baseline beside the model for the same window', () => {
    const demo = createDemo('atypical');
    run(demo, 180);
    const early = demo.view();
    expect(early.result?.tStart).toBe(early.baseline?.tStart);
    expect(early.result?.state).toBe('change-to-verify');
    expect(early.baseline?.state).toBe('within-pattern');
    run(demo, WINDOW_SIZE);
    expect(demo.view().baseline?.state).toBe('change-to-verify');
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

  test('keeps every window read so far', () => {
    const demo = createDemo('usual');
    run(demo, 35);
    expect(demo.view().results.map((r) => r.tStart)).toEqual([0, 10, 20]);
  });

  test('logs the session from start to finish', () => {
    const demo = createDemo('usual');
    expect(demo.view().log).toEqual([]);
    run(demo, SESSION_LENGTH);
    const messages = demo.view().log.map((entry) => entry.message);
    expect(messages[0]).toBe('session started: usual recovery');
    expect(messages).toContain('phase: exercise');
    expect(messages).toContain('phase: recovery');
    expect(messages.at(-1)).toBe('session complete');
    expect(messages.filter((m) => m.startsWith('window '))).toHaveLength(30);
    expect(demo.view().log.some((entry) => entry.level === 'alert')).toBe(false);
  });

  test('logs lost contact and windows that were not scored', () => {
    const demo = createDemo('misplaced');
    run(demo, SESSION_LENGTH);
    const log = demo.view().log;
    expect(log.find((e) => e.message === 'skin contact lost')).toMatchObject({ t: 171, source: 'sensor', level: 'warn' });
    expect(log.some((e) => e.message === 'skin contact restored')).toBe(true);
    expect(log.some((e) => e.message === 'window 02:50-03:00 not scored: no skin contact')).toBe(true);
    expect(log.some((e) => e.message.endsWith('not scored: movement interference'))).toBe(true);
  });

  test('logs the alert and the event on its way to the ground', () => {
    const demo = createDemo('atypical');
    run(demo, SESSION_LENGTH);
    demo.setConnected(true);
    run(demo, DEFAULT_DELAY);
    const log = demo.view().log;
    const messages = log.map((entry) => entry.message);
    expect(messages).toContain('link to Earth down');
    expect(log.filter((entry) => entry.level === 'alert')).toHaveLength(1);
    const order = [
      'evt-170 saved on board',
      'evt-170 waiting: no link',
      'link to Earth up',
      'evt-170 sending to ground',
      'evt-170 received on ground',
    ].map((message) => messages.indexOf(message));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('reset clears the log', () => {
    const demo = createDemo('usual');
    run(demo, 50);
    demo.reset();
    expect(demo.view().log).toEqual([]);
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
