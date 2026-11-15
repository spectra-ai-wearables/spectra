import type { MissionEvent, QueuedEvent } from './types';

/** Simulated one-way delay to the ground, in simulation seconds. */
export const DEFAULT_DELAY = 8;

export interface LinkQueue {
  enqueue(event: MissionEvent): void;
  tick(now: number, connected: boolean): void;
  items(): QueuedEvent[];
}

export function createLinkQueue(delay: number = DEFAULT_DELAY): LinkQueue {
  const queue: QueuedEvent[] = [];

  return {
    enqueue(event) {
      if (queue.some((item) => item.event.id === event.id)) return;
      queue.push({ event, stage: 'saved', sentAt: null, receivedAt: null });
    },

    tick(now, connected) {
      for (const item of queue) {
        if (item.stage === 'received') continue;
        if (!connected) {
          item.stage = 'waiting';
          item.sentAt = null;
        } else if (item.sentAt === null) {
          item.stage = 'sending';
          item.sentAt = now;
        } else if (now - item.sentAt >= delay) {
          item.stage = 'received';
          item.receivedAt = now;
        }
      }
    },

    items() {
      return queue.map((item) => ({ ...item }));
    },
  };
}
