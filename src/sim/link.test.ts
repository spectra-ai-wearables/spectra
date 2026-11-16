import { describe, expect, test } from 'vitest';
import { PACKET_BYTES, createLink, packetsFor, plannedPackets } from './link';
import type { LinkConditions, Message, Priority } from './link';
import { mulberry32 } from './random';

const message = (id: string, priority: Priority = 1, bytes = 64, createdAt = 0): Message => ({
  id,
  priority,
  bytes,
  createdAt,
  label: id,
  seqs: [1],
});

const clear: LinkConditions = { available: true, bytesPerSecond: 1000, loss: 0, delay: 5 };
const down: LinkConditions = { ...clear, available: false };

describe('createLink', () => {
  test('stores a new message as saved', () => {
    const link = createLink();
    link.enqueue(message('a'));
    expect(link.items()[0]).toMatchObject({ stage: 'saved', sent: 0, receivedAt: null });
  });

  test('delivers one light-time after the message leaves', () => {
    const link = createLink();
    link.enqueue(message('a'));
    link.tick(10, clear);
    expect(link.items()[0]).toMatchObject({ stage: 'in-flight', departedAt: 10, arrivesAt: 15 });
    link.tick(14, clear);
    expect(link.items()[0].stage).toBe('in-flight');
    link.tick(15, clear);
    expect(link.items()[0]).toMatchObject({ stage: 'received', receivedAt: 15 });
  });

  test('holds messages while the link is down', () => {
    const link = createLink();
    link.enqueue(message('a'));
    for (let now = 0; now < 100; now++) link.tick(now, down);
    expect(link.items()[0]).toMatchObject({ stage: 'waiting', sent: 0, receivedAt: null });
  });

  test('a message already on its way still arrives if the link drops', () => {
    const link = createLink();
    link.enqueue(message('a'));
    link.tick(0, clear);
    link.tick(3, down);
    link.tick(5, down);
    expect(link.items()[0].stage).toBe('received');
  });

  test('a slow link takes several seconds to send one message', () => {
    const link = createLink();
    link.enqueue(message('a', 1, 4 * PACKET_BYTES));
    const slow = { ...clear, bytesPerSecond: PACKET_BYTES };
    link.tick(0, slow);
    expect(link.items()[0]).toMatchObject({ stage: 'sending', sent: 1 });
    for (let now = 1; now <= 3; now++) link.tick(now, slow);
    expect(link.items()[0]).toMatchObject({ stage: 'in-flight', departedAt: 3 });
  });

  test('sends the alert first, even when it was queued last', () => {
    const link = createLink();
    link.enqueue(message('raw', 2, 20 * PACKET_BYTES, 0));
    link.enqueue(message('update', 1, 4 * PACKET_BYTES, 1));
    link.enqueue(message('alert', 0, 4 * PACKET_BYTES, 2));
    const slow = { ...clear, bytesPerSecond: PACKET_BYTES };
    for (let now = 0; now < 40; now++) link.tick(now, slow);
    const left = Object.fromEntries(link.items().map((item) => [item.message.id, item.departedAt]));
    expect(left.alert).toBeLessThan(left.update!);
    expect(left.update).toBeLessThan(left.raw!);
  });

  test('ignores a message that is already queued', () => {
    const link = createLink();
    link.enqueue(message('a'));
    link.enqueue(message('a'));
    expect(link.items()).toHaveLength(1);
  });

  test('returns copies so callers cannot change the queue', () => {
    const link = createLink();
    link.enqueue(message('a'));
    link.items()[0].stage = 'received';
    expect(link.items()[0].stage).toBe('saved');
  });

  test('plans repair packets for the expected loss', () => {
    expect(packetsFor(144)).toBe(5);
    expect(plannedPackets(5, 0)).toBe(5);
    expect(plannedPackets(5, 0.4)).toBe(14);
    expect(plannedPackets(5, 1)).toBe(plannedPackets(5, 0.9));
  });

  test('under loss, sends more than the message needs and counts what was lost', () => {
    const link = createLink(3);
    link.enqueue(message('a', 0, 5 * PACKET_BYTES));
    const lossy = { ...clear, loss: 0.4 };
    for (let now = 0; now < 30; now++) link.tick(now, lossy);
    const stats = link.stats();
    expect(link.items()[0].stage).toBe('received');
    expect(stats.packetsSent).toBeGreaterThanOrEqual(14);
    expect(stats.packetsLost).toBeGreaterThan(0);
    expect(stats.bytesSent).toBe(stats.packetsSent * PACKET_BYTES);
  });

  test('schedules a resend one round trip later when too few packets survive', () => {
    const link = createLink(1);
    link.enqueue(message('a', 0, 4 * PACKET_BYTES));
    // The sender expects no loss, so it sends no repair packets; nearly everything is lost.
    const blind: LinkConditions = { ...clear, loss: 0 };
    const storm: LinkConditions = { ...clear, loss: 0.95, expectedLoss: 0 };
    link.tick(0, { ...storm, bytesPerSecond: 100_000 });
    const [item] = link.items();
    expect(item.stage).toBe('repair');
    expect(link.stats().repairs).toBeGreaterThan(0);
    link.tick(9, blind);
    expect(link.items()[0].stage).toBe('repair');
    link.tick(10, blind);
    expect(link.items()[0].stage).toBe('in-flight');
    link.tick(15, blind);
    expect(link.items()[0]).toMatchObject({ stage: 'received', attempts: 2 });
  });

  test('whatever the outages and losses, every message arrives exactly once', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = mulberry32(seed);
      const link = createLink(seed);
      const ids: string[] = [];
      for (let now = 0; now < 400; now++) {
        if (now < 200 && random() < 0.1) {
          const id = `m${ids.length}`;
          ids.push(id);
          link.enqueue(message(id, Math.floor(random() * 3) as Priority, 32 + Math.floor(random() * 300), now));
        }
        link.tick(now, {
          available: random() < 0.6,
          bytesPerSecond: 64,
          loss: random() < 0.3 ? 0.5 : 0,
          delay: 7,
        });
      }
      for (let now = 400; now < 2000; now++) link.tick(now, { ...clear, delay: 7 });
      const items = link.items();
      expect(items.map((item) => item.message.id).sort()).toEqual([...ids].sort());
      expect(items.every((item) => item.stage === 'received' && item.receivedAt !== null)).toBe(true);
    }
  });

  test('among messages waiting together, a higher priority never leaves later', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = mulberry32(seed);
      const link = createLink(seed);
      for (let i = 0; i < 12; i++) link.enqueue(message(`m${i}`, Math.floor(random() * 3) as Priority, 64 + Math.floor(random() * 200), 0));
      for (let now = 0; now < 600; now++) link.tick(now, { available: random() < 0.7, bytesPerSecond: 48, loss: 0, delay: 3 });
      const items = link.items();
      for (const a of items) {
        for (const b of items) {
          if (a.message.priority < b.message.priority) expect(a.departedAt!).toBeLessThanOrEqual(b.departedAt!);
        }
      }
    }
  });
});