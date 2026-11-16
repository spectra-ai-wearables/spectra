import { describe, expect, test } from 'vitest';
import { GENESIS, createGroundLedger, createLedger, verifyChain } from './ledger';
import { mulberry32 } from './random';
import { sha256 } from './sha256';

describe('sha256', () => {
  test('matches the published test vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
});

const filled = (count: number) => {
  const ledger = createLedger();
  for (let i = 0; i < count; i++) ledger.append(i * 10, 'telemetry', `body ${i}`);
  return ledger;
};

describe('ledger', () => {
  test('chains every record to the one before it', () => {
    const entries = filled(4).entries();
    expect(entries[0].prev).toBe(GENESIS);
    expect(entries[2].prev).toBe(entries[1].hash);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
    expect(verifyChain(entries)).toBe(true);
  });

  test('detects an altered or missing record', () => {
    const entries = filled(4).entries();
    expect(verifyChain(entries.map((entry) => (entry.seq === 2 ? { ...entry, body: 'changed' } : entry)))).toBe(false);
    expect(verifyChain(entries.filter((entry) => entry.seq !== 2))).toBe(false);
  });

  test('resumes from stored records after a restart', () => {
    const before = filled(3);
    const after = createLedger(before.entries());
    const entry = after.append(99, 'alert', 'x');
    expect(entry.seq).toBe(4);
    expect(verifyChain(after.entries())).toBe(true);
  });

  test('the ground reports only the ranges it lacks', () => {
    const entries = filled(8).entries();
    const ground = createGroundLedger();
    for (const seq of [1, 2, 5, 8]) ground.receive(entries[seq - 1]);
    expect(ground.verified()).toBe(2);
    expect(ground.missing()).toEqual([[3, 4], [6, 7]]);
    expect(ground.missing(10)).toEqual([[3, 4], [6, 7], [9, 10]]);
  });

  test('merging is idempotent', () => {
    const entries = filled(3).entries();
    const ground = createGroundLedger();
    expect(ground.receive(entries[0])).toBe('accepted');
    expect(ground.receive(entries[0])).toBe('duplicate');
    expect(ground.entries()).toHaveLength(1);
    expect(ground.duplicates()).toBe(1);
  });

  test('rejects a record whose hash does not match', () => {
    const [entry] = filled(1).entries();
    const ground = createGroundLedger();
    expect(ground.receive({ ...entry, body: 'forged' })).toBe('rejected');
    expect(ground.entries()).toEqual([]);
  });

  test('any order, any repetition: the ground ends with the same verified log', () => {
    const entries = filled(20).entries();
    for (let seed = 1; seed <= 25; seed++) {
      const random = mulberry32(seed);
      const ground = createGroundLedger();
      const stream = [...entries, ...entries.filter(() => random() < 0.5)].sort(() => random() - 0.5);
      for (const entry of stream) ground.receive(entry);
      expect(ground.verified()).toBe(20);
      expect(ground.missing()).toEqual([]);
      expect(ground.entries()).toEqual(entries);
    }
  });
});