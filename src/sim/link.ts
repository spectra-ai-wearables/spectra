/**
 * Store-and-forward link between the on-board server and the ground.
 *
 * Messages wait on board, leave in priority order when the link allows, and
 * arrive one light-time later. Asking for a resend costs a round trip of
 * minutes, so each message goes out with extra repair packets: the receiver
 * rebuilds it from any sufficient subset. That behaviour is modelled as an
 * ideal erasure code; the packets themselves are not encoded here.
 */
import { mulberry32 } from './random';

/** 0: alert summary. 1: events and residuals. 2: raw windows, on request. */
export type Priority = 0 | 1 | 2;

export interface Message {
  id: string;
  priority: Priority;
  bytes: number;
  createdAt: number;
  label: string;
  /** Sequence numbers of the ledger records this message carries. */
  seqs: number[];
}

export interface LinkConditions {
  available: boolean;
  bytesPerSecond: number;
  /** Fraction of packets lost on the way, 0..1. */
  loss: number;
  /** One-way light time, in seconds. */
  delay: number;
  /** Loss the sender plans for; the actual loss when omitted. */
  expectedLoss?: number;
}

export type TransferStage = 'saved' | 'waiting' | 'sending' | 'in-flight' | 'repair' | 'received';

export interface Transfer {
  message: Message;
  stage: TransferStage;
  /** Packets the receiver needs to rebuild the message. */
  needed: number;
  /** Packets planned for this attempt, repair packets included. */
  planned: number;
  sent: number;
  attempts: number;
  departedAt: number | null;
  arrivesAt: number | null;
  receivedAt: number | null;
}

export interface LinkStats {
  packetsSent: number;
  packetsLost: number;
  bytesSent: number;
  repairs: number;
}

export interface Link {
  enqueue(message: Message): void;
  tick(now: number, conditions: LinkConditions): void;
  items(): Transfer[];
  stats(): LinkStats;
}

export const PACKET_BYTES = 32;
/** Extra packets sent beyond what the expected loss alone would call for. */
export const REPAIR_MARGIN = 1.5;
const MAX_PLANNED_LOSS = 0.9;

interface Internal extends Transfer {
  arrived: number;
  retryAt: number | null;
}

export function packetsFor(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / PACKET_BYTES));
}

/** Packets to send so that enough of them survive the expected loss. */
export function plannedPackets(needed: number, loss: number): number {
  const expected = Math.min(Math.max(loss, 0), MAX_PLANNED_LOSS);
  return expected === 0 ? needed : Math.ceil((needed / (1 - expected)) * REPAIR_MARGIN) + 1;
}

export function createLink(seed = 1): Link {
  const random = mulberry32(seed);
  const queue: Internal[] = [];
  const stats: LinkStats = { packetsSent: 0, packetsLost: 0, bytesSent: 0, repairs: 0 };
  let credit = 0;

  const unfinished = (item: Internal) => item.stage !== 'in-flight' && item.stage !== 'received';

  return {
    enqueue(message) {
      if (queue.some((item) => item.message.id === message.id)) return;
      queue.push({
        message: { ...message, seqs: [...message.seqs] },
        stage: 'saved',
        needed: packetsFor(message.bytes),
        planned: 0,
        sent: 0,
        arrived: 0,
        attempts: 0,
        departedAt: null,
        arrivesAt: null,
        receivedAt: null,
        retryAt: null,
      });
    },

    tick(now, conditions) {
      for (const item of queue) {
        if (item.stage === 'in-flight' && item.arrivesAt !== null && now >= item.arrivesAt) {
          item.stage = 'received';
          item.receivedAt = item.arrivesAt;
        }
        if (item.stage === 'repair' && item.retryAt !== null && now >= item.retryAt) {
          item.stage = 'saved';
          item.retryAt = null;
        }
      }

      if (!conditions.available) {
        credit = 0;
        for (const item of queue) {
          if (item.stage === 'saved' || item.stage === 'sending') item.stage = 'waiting';
        }
        return;
      }
      for (const item of queue) {
        if (item.stage === 'waiting') item.stage = item.sent > 0 ? 'sending' : 'saved';
      }

      credit += conditions.bytesPerSecond;
      while (credit >= PACKET_BYTES) {
        const next = queue
          .filter((item) => unfinished(item) && item.stage !== 'repair')
          .sort((a, b) => a.message.priority - b.message.priority || a.message.createdAt - b.message.createdAt)[0];
        if (!next) {
          credit = 0;
          break;
        }
        if (next.sent === 0) {
          next.planned = plannedPackets(next.needed, conditions.expectedLoss ?? conditions.loss);
          next.attempts += 1;
        }
        next.stage = 'sending';
        next.sent += 1;
        credit -= PACKET_BYTES;
        stats.packetsSent += 1;
        stats.bytesSent += PACKET_BYTES;
        if (random() < conditions.loss) stats.packetsLost += 1;
        else next.arrived += 1;

        if (next.sent < next.planned) continue;
        if (next.arrived >= next.needed) {
          next.stage = 'in-flight';
          next.departedAt = now;
          next.arrivesAt = now + conditions.delay;
        } else {
          // Too few packets survived. The ground notices the gap when it
          // checks the ledger; its report takes a round trip to come back.
          next.stage = 'repair';
          next.retryAt = now + 2 * conditions.delay;
          next.sent = 0;
          next.arrived = 0;
          stats.repairs += 1;
        }
      }
    },

    items() {
      return queue.map(({ arrived: _arrived, retryAt: _retryAt, ...item }) => ({
        ...item,
        message: { ...item.message, seqs: [...item.message.seqs] },
      }));
    },

    stats: () => ({ ...stats }),
  };
}
