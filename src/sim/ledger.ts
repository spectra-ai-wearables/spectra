/**
 * Append-only event log. Every record carries the hash of the one before it,
 * so the ground can tell that nothing is missing or altered, ask only for the
 * ranges it lacks, and merge the same record twice without harm.
 */
import { sha256 } from './sha256';

export interface LedgerEntry {
  seq: number;
  /** Simulation second at which the record was written on board. */
  t: number;
  kind: string;
  body: string;
  /** Hash of the previous record; the first record points at GENESIS. */
  prev: string;
  hash: string;
}

export const GENESIS = '0'.repeat(64);

const digest = (entry: Omit<LedgerEntry, 'hash'>) =>
  sha256(`${entry.prev}|${entry.seq}|${entry.t}|${entry.kind}|${entry.body}`);

export interface Ledger {
  append(t: number, kind: string, body: string): LedgerEntry;
  entries(): LedgerEntry[];
  /** Records with a sequence number in [from, to]. */
  range(from: number, to: number): LedgerEntry[];
  head(): number;
}

/** The on-board log. Pass the stored records to resume after a restart. */
export function createLedger(stored: LedgerEntry[] = []): Ledger {
  const log = stored.map((entry) => ({ ...entry }));
  return {
    append(t, kind, body) {
      const partial = { seq: log.length + 1, t, kind, body, prev: log.at(-1)?.hash ?? GENESIS };
      const entry = { ...partial, hash: digest(partial) };
      log.push(entry);
      return { ...entry };
    },
    entries: () => log.map((entry) => ({ ...entry })),
    range: (from, to) => log.filter((entry) => entry.seq >= from && entry.seq <= to).map((entry) => ({ ...entry })),
    head: () => log.length,
  };
}

/** True when every record's hash is right and each one points at the record before it. */
export function verifyChain(entries: LedgerEntry[]): boolean {
  let prev = GENESIS;
  let seq = 1;
  for (const entry of entries) {
    const { hash, ...partial } = entry;
    if (entry.seq !== seq || entry.prev !== prev || digest(partial) !== hash) return false;
    prev = hash;
    seq += 1;
  }
  return true;
}

export type Receipt = 'accepted' | 'duplicate' | 'rejected';

export interface GroundLedger {
  receive(entry: LedgerEntry): Receipt;
  entries(): LedgerEntry[];
  /** Highest sequence number up to which the chain is complete and checked. */
  verified(): number;
  /** Sequence ranges the ground lacks, up to the highest number it knows of. */
  missing(knownHead?: number): Array<[from: number, to: number]>;
  duplicates(): number;
}

/** The ground's copy. It accepts records in any order and any number of times. */
export function createGroundLedger(): GroundLedger {
  const held = new Map<number, LedgerEntry>();
  let verified = 0;
  let duplicates = 0;

  const advance = () => {
    for (;;) {
      const next = held.get(verified + 1);
      const prev = verified === 0 ? GENESIS : held.get(verified)!.hash;
      if (!next || next.prev !== prev) return;
      verified += 1;
    }
  };

  return {
    receive(entry) {
      const { hash, ...partial } = entry;
      if (digest(partial) !== hash) return 'rejected';
      const existing = held.get(entry.seq);
      if (existing) {
        if (existing.hash !== hash) return 'rejected';
        duplicates += 1;
        return 'duplicate';
      }
      held.set(entry.seq, { ...entry });
      advance();
      return 'accepted';
    },
    entries: () => [...held.values()].sort((a, b) => a.seq - b.seq).map((entry) => ({ ...entry })),
    verified: () => verified,
    missing(knownHead = Math.max(0, ...held.keys())) {
      const gaps: Array<[number, number]> = [];
      let open: number | null = null;
      for (let seq = 1; seq <= knownHead; seq++) {
        const absent = !held.has(seq);
        if (absent && open === null) open = seq;
        if (!absent && open !== null) {
          gaps.push([open, seq - 1]);
          open = null;
        }
      }
      if (open !== null) gaps.push([open, knownHead]);
      return gaps;
    },
    duplicates: () => duplicates,
  };
}
