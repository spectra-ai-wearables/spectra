import { describe, expect, test } from 'vitest';
import { DEFAULT_DELAY, createLinkQueue } from './link';
import type { MissionEvent } from './types';

const event = (id = 'evt-1'): MissionEvent => ({
  id,
  createdAt: 0,
  title: 'Heart rate outside recovery pattern',
  detail: 'detail',
});

describe('createLinkQueue', () => {
  test('stores a new event as saved', () => {
    const link = createLinkQueue();
    link.enqueue(event());
    expect(link.items()).toEqual([
      { event: event(), stage: 'saved', sentAt: null, receivedAt: null },
    ]);
  });

  test('delivers after the delay when connected', () => {
    const link = createLinkQueue(5);
    link.enqueue(event());
    link.tick(10, true);
    expect(link.items()[0].stage).toBe('sending');
    link.tick(14, true);
    expect(link.items()[0].stage).toBe('sending');
    link.tick(15, true);
    expect(link.items()[0]).toMatchObject({ stage: 'received', receivedAt: 15 });
  });

  test('uses the default delay', () => {
    const link = createLinkQueue();
    link.enqueue(event());
    link.tick(0, true);
    link.tick(DEFAULT_DELAY - 1, true);
    expect(link.items()[0].stage).toBe('sending');
    link.tick(DEFAULT_DELAY, true);
    expect(link.items()[0].stage).toBe('received');
  });

  test('holds events while the link is down', () => {
    const link = createLinkQueue(5);
    link.enqueue(event());
    for (let now = 0; now < 100; now++) link.tick(now, false);
    expect(link.items()[0]).toMatchObject({ stage: 'waiting', sentAt: null, receivedAt: null });
  });

  test('delivers exactly once after reconnection', () => {
    const link = createLinkQueue(5);
    link.enqueue(event());
    link.tick(0, false);
    link.tick(20, true);
    link.tick(25, true);
    link.tick(40, true);
    link.tick(41, false);
    link.tick(60, true);
    const items = link.items();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ stage: 'received', receivedAt: 25 });
  });

  test('restarts a transmission interrupted mid-flight', () => {
    const link = createLinkQueue(5);
    link.enqueue(event());
    link.tick(0, true);
    link.tick(3, false);
    expect(link.items()[0].stage).toBe('waiting');
    link.tick(10, true);
    link.tick(14, true);
    expect(link.items()[0].stage).toBe('sending');
    link.tick(15, true);
    expect(link.items()[0].stage).toBe('received');
  });

  test('ignores an event that is already queued', () => {
    const link = createLinkQueue();
    link.enqueue(event());
    link.enqueue(event());
    expect(link.items()).toHaveLength(1);
  });

  test('returns copies so callers cannot change the queue', () => {
    const link = createLinkQueue();
    link.enqueue(event());
    link.items()[0].stage = 'received';
    expect(link.items()[0].stage).toBe('saved');
  });
});
