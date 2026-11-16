import { describe, expect, test } from 'vitest';
import { WINDOW_SIZE } from '../sim/anomaly';
import { SESSION_LENGTH } from '../sim/baseline';
import { verifyChain } from '../sim/ledger';
import { SCENARIOS } from '../sim/scenarios';
import { blackoutOn, missionDay } from '../sim/sources/horizons';
import { QUALITY_TARGET, createDemo } from './controller';
import type { Demo } from './controller';

const run = (demo: Demo, steps: number) => {
  for (let i = 0; i < steps; i++) demo.step();
};

/** Plays the session, then lets everything on board reach the ground. */
const finish = (demo: Demo) => {
  run(demo, SESSION_LENGTH);
  demo.advance(2 * demo.view().link.delay + 600);
};

describe('createDemo', () => {
  test('starts paused at zero with nothing to show', () => {
    const view = createDemo('usual').view();
    expect(view).toMatchObject({ elapsed: 0, clock: 0, playing: false, finished: false, selected: 'CDR', latest: null, result: null, explanation: null });
    expect(view.scenario.id).toBe('usual');
    expect(view.samples).toEqual([]);
    expect(view.incidents).toEqual([]);
    expect(view.crew.map((card) => card.state)).toEqual(['idle', 'idle', 'idle', 'idle']);
  });

  test('reveals one sample per step and the latest complete window', () => {
    const demo = createDemo('usual');
    run(demo, WINDOW_SIZE - 1);
    expect(demo.view().result).toBeNull();
    run(demo, 16);
    const view = demo.view();
    expect(view.samples).toHaveLength(25);
    expect(view.latest?.t).toBe(24);
    expect(view.result?.tStart).toBe(WINDOW_SIZE);
    expect(view.results.map((result) => result.tStart)).toEqual([0, 10]);
    expect(view.crew[0].heat).toHaveLength(2);
  });

  test('takes the light time from the ephemeris for the mission date', () => {
    const demo = createDemo('usual');
    const day = missionDay('2026-11-15')!;
    expect(demo.view().link.delay).toBe(Math.round(day.lightSeconds));
    expect(demo.view().mission.date).toBe('2026-11-15');
    demo.setMissionDate('2027-02-20');
    expect(demo.view().link.delay).toBe(Math.round(missionDay('2027-02-20')!.lightSeconds));
    demo.setMissionDate('1999-01-01');
    expect(demo.view().mission.date).toBe('2027-02-20');
  });

  test('usual recovery: no incident, every record verified on the ground', () => {
    const demo = createDemo('usual');
    run(demo, SESSION_LENGTH);
    expect(demo.view().finished).toBe(true);
    expect(demo.view().settled).toBe(false);
    demo.advance(demo.view().link.delay + 10);
    const view = demo.view();
    expect(view.settled).toBe(true);
    expect(view.incidents).toEqual([]);
    expect(view.explanation?.label).toBe('Within your pattern');
    expect(view.ledger).toMatchObject({ head: 5, verified: 5, missing: [], duplicates: 0 });
    expect(view.quality).toEqual({ reliable: 120, total: 120, target: QUALITY_TARGET });
  });

  test('sending only what the ground could not predict costs far less than raw windows', () => {
    const demo = createDemo('usual');
    finish(demo);
    const { sent, raw } = demo.view().bytes;
    expect(raw).toBe(5 * (48 + 4 * 6 * 160));
    expect(sent).toBeGreaterThan(0);
    expect(sent / raw).toBeLessThan(0.1);
  });

  test('loose band: no data is shown as no data, and no incident is raised', () => {
    const demo = createDemo('loose-band');
    run(demo, 200);
    expect(demo.view().explanation?.label).toBe('Not enough reliable data');
    expect(demo.view().crew[0]).toMatchObject({ state: 'no-data', cause: 'sensor' });
    run(demo, 100);
    const view = demo.view();
    expect(view.incidents).toEqual([]);
    expect(view.quality.reliable / view.quality.total).toBeLessThan(1);
  });

  test('the ground sees a discarded window as a gap, never as a value', () => {
    const demo = createDemo('loose-band');
    finish(demo);
    const gaps = demo.view().twin.filter((estimate) => estimate.basis === 'gap');
    expect(gaps.length).toBeGreaterThan(4);
    expect(gaps.every((estimate) => estimate.hr === null)).toBe(true);
  });

  test('atypical recovery: the alert is raised on board and waits for the link', () => {
    const demo = createDemo('atypical-recovery');
    expect(demo.view().link).toMatchObject({ switchOn: false, available: false, reason: 'switched-off' });
    run(demo, 189);
    expect(demo.view().incidents).toEqual([]);
    demo.step();
    expect(demo.view().explanation?.label).toBe('Change to verify');
    expect(demo.view().cause).toBe('physiological');
    run(demo, SESSION_LENGTH - 190);
    const view = demo.view();
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0]).toMatchObject({ stage: 'waiting', receivedAt: null });
    expect(view.settled).toBe(false);
  });

  test('while nothing arrives the ground projects, and catches up when the link returns', () => {
    const demo = createDemo('atypical-recovery');
    run(demo, SESSION_LENGTH);
    expect(demo.view().twin.every((estimate) => estimate.basis === 'projected')).toBe(true);
    demo.setConnected(true);
    demo.advance(demo.view().link.delay + 10);
    const view = demo.view();
    expect(view.twin.some((estimate) => estimate.basis === 'reported')).toBe(true);
    expect(view.twin.every((estimate) => estimate.basis !== 'projected')).toBe(true);
    expect(view.incidents[0].stage).toBe('received');
    expect(view.incidents[0].receivedAt! - view.incidents[0].incident.firstAt).toBeGreaterThanOrEqual(view.link.delay);
    expect(view.settled).toBe(true);
  });

  test('sensor fault and body change raise separate incidents with different causes', () => {
    const demo = createDemo('sensor-drift');
    run(demo, SESSION_LENGTH);
    const causes = Object.fromEntries(demo.view().incidents.map((item) => [item.incident.crew[0], item.incident.cause]));
    expect(causes).toEqual({ CDR: 'sensor', PLT: 'physiological' });
    expect(demo.view().explanation?.action).toContain('Reseat the band');
    demo.selectCrew('PLT');
    expect(demo.view().selected).toBe('PLT');
    expect(demo.view().explanation?.action).toContain('log how you feel');
  });

  test('slow drift warns before it alerts', () => {
    const demo = createDemo('slow-drift');
    const seen: string[] = [];
    for (let i = 0; i < SESSION_LENGTH; i++) {
      demo.step();
      const state = demo.view().crew.find((card) => card.id === 'MS2')!.state;
      if (seen.at(-1) !== state) seen.push(state);
    }
    expect(seen).toEqual(['idle', 'ok', 'warn', 'alert']);
  });

  test('cabin event: four alerts, one incident', () => {
    const demo = createDemo('cabin-event');
    run(demo, SESSION_LENGTH);
    const view = demo.view();
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0].incident).toMatchObject({ cause: 'environment', suppressed: 3 });
    expect([...view.incidents[0].incident.crew].sort()).toEqual(['CDR', 'MS1', 'MS2', 'PLT']);
    expect(view.crew.every((card) => card.state === 'alert')).toBe(true);
  });

  test('particle event: the link degrades, packets are lost, the alert still arrives', () => {
    const demo = createDemo('particle-storm');
    run(demo, 100);
    expect(demo.view().link).toMatchObject({ disturbed: true, loss: 0.4, available: true });
    run(demo, SESSION_LENGTH - 100);
    expect(demo.view().link.disturbed).toBe(false);
    demo.advance(2 * demo.view().link.delay + 600);
    const view = demo.view();
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0].stage).toBe('received');
    expect(view.settled).toBe(true);
    expect(view.bytes.packetsLost).toBeGreaterThan(0);
    expect(view.bytes.repairs).toBe(0);
    expect(view.log.some((entry) => entry.message.startsWith('link degraded'))).toBe(true);
  });

  test('solar conjunction: nothing leaves until the blackout ends, then the alert goes first', () => {
    const demo = createDemo('conjunction');
    expect(demo.view().link).toMatchObject({ available: false, reason: 'blackout', switchOn: true });
    run(demo, SESSION_LENGTH);
    demo.advance(3600);
    let view = demo.view();
    expect(view.settled).toBe(false);
    expect(view.transfers.every((item) => item.stage === 'waiting')).toBe(true);
    expect(view.ledger.verified).toBe(0);

    const end = view.mission.blackout!.end;
    demo.advanceToContact();
    expect(demo.view().mission.date).toBe(end);
    expect(blackoutOn(demo.view().mission.date)).toBeNull();
    demo.setDegraded(true);
    demo.advance(demo.view().link.delay + 600);
    view = demo.view();
    expect(view.settled).toBe(true);
    const alert = view.transfers.find((item) => item.message.priority === 0)!;
    for (const item of view.transfers) expect(alert.departedAt!).toBeLessThanOrEqual(item.departedAt!);
    expect(view.ledger.verified).toBe(view.ledger.head);
  });

  test('server restart: unacknowledged records are resent, duplicates dropped, nothing lost', () => {
    const demo = createDemo('server-restart');
    finish(demo);
    const view = demo.view();
    expect(view.log.some((entry) => entry.message.startsWith('server restarted'))).toBe(true);
    expect(view.ledger.duplicates).toBeGreaterThan(0);
    expect(view.ledger).toMatchObject({ head: 6, verified: 6, missing: [] });
    expect(view.incidents).toHaveLength(1);
    expect(view.incidents[0].stage).toBe('received');
    expect(view.settled).toBe(true);
  });

  test('raw windows travel only when the ground asks, after a round trip', () => {
    const demo = createDemo('atypical-recovery');
    demo.setConnected(true);
    finish(demo);
    const { incident } = demo.view().incidents[0];
    expect(demo.view().incidents[0].raw).toBe('none');
    demo.requestRaw(incident.id);
    expect(demo.view().incidents[0].raw).toBe('requested');
    expect(demo.view().settled).toBe(false);
    const delay = demo.view().link.delay;
    demo.advance(delay);
    expect(demo.view().incidents[0].raw).toBe('in-transit');
    demo.advance(delay + 10);
    expect(demo.view().incidents[0].raw).toBe('received');
    expect(demo.view().transfers.find((item) => item.message.priority === 2)).toBeDefined();
    expect(demo.view().settled).toBe(true);
  });

  test('injected loss and a degraded rate show in the link conditions', () => {
    const demo = createDemo('usual');
    const nominal = demo.view().link.bytesPerSecond;
    demo.setLossInjected(true);
    demo.setDegraded(true);
    expect(demo.view().link).toMatchObject({ loss: 0.3, lossInjected: true, degraded: true });
    expect(demo.view().link.bytesPerSecond).toBeCloseTo(nominal / 100, 6);
  });

  test.each(SCENARIOS.map((scenario) => scenario.id))('%s runs to the end and settles with a verified ledger', (id) => {
    const demo = createDemo(id);
    run(demo, SESSION_LENGTH);
    demo.setConnected(true);
    demo.advanceToContact();
    demo.advance(2 * demo.view().link.delay + 900);
    const view = demo.view();
    expect(view.settled).toBe(true);
    expect(view.ledger.verified).toBe(view.ledger.head);
    expect(view.incidents.every((item) => item.stage === 'received')).toBe(true);
    expect(view.incidents).toHaveLength(view.scenario.expected.incidents);
  });

  test('logs the session from start to finish', () => {
    const demo = createDemo('usual');
    expect(demo.view().log).toEqual([]);
    run(demo, SESSION_LENGTH);
    const messages = demo.view().log.map((entry) => entry.message);
    expect(messages[0]).toBe('session started: usual recovery');
    expect(messages).toContain('phase: exercise');
    expect(messages).toContain('phase: recovery');
    expect(messages).toContain('session complete');
    expect(demo.view().log.some((entry) => entry.level === 'alert')).toBe(false);
  });

  test('logs the alert on its way to the ground, in order', () => {
    const demo = createDemo('atypical-recovery');
    run(demo, SESSION_LENGTH);
    demo.setConnected(true);
    demo.advance(demo.view().link.delay + 10);
    const messages = demo.view().log.map((entry) => entry.message);
    const order = ['link to Earth down', 'CDR change to verify, likely cause: physiological', 'Alert CDR waiting: no link', 'link to Earth up', 'Alert CDR received on ground'].map(
      (message) => messages.findIndex((candidate) => candidate.startsWith(message)),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('play and pause only change the playing flag', () => {
    const demo = createDemo('usual');
    demo.play();
    expect(demo.view().playing).toBe(true);
    demo.pause();
    expect(demo.view()).toMatchObject({ playing: false, elapsed: 0 });
  });

  test('select and reset restart with the scenario defaults', () => {
    const demo = createDemo('atypical-recovery');
    run(demo, SESSION_LENGTH);
    demo.setConnected(true);
    demo.play();
    demo.reset();
    expect(demo.view()).toMatchObject({ elapsed: 0, playing: false, log: [], incidents: [] });
    expect(demo.view().link.switchOn).toBe(false);
    demo.select('usual');
    expect(demo.view().scenario.id).toBe('usual');
    expect(demo.view().link.switchOn).toBe(true);
  });
});

test('the on-board ledger of a finished session is one unbroken chain', async () => {
  const { createLedger } = await import('../sim/ledger');
  const ledger = createLedger();
  for (let i = 0; i < 6; i++) ledger.append(i * 60, 'telemetry', '{}');
  expect(verifyChain(ledger.entries())).toBe(true);
});
