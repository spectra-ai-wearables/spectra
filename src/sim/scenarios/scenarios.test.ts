import { describe, expect, test } from 'vitest';
import storedModel from '../../ml/model.json';
import type { Model } from '../../ml/network';
import { SESSION_LENGTH } from '../baseline';
import { runScenario, scenarioAlerts } from '../crew';
import { generateSession } from '../generator';
import { correlate } from '../incidents';
import { blackoutOn, coverage, missionDay } from '../sources/horizons';
import { CREW, SCENARIOS, scenarioById } from './index';

const model = storedModel as Model;

describe('scenario library', () => {
  test('ids are unique and every mission date is inside the ephemeris', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length);
    const range = coverage();
    for (const scenario of SCENARIOS) {
      expect(scenario.link.missionDate >= range.start && scenario.link.missionDate <= range.end).toBe(true);
      expect(missionDay(scenario.link.missionDate)).not.toBeNull();
    }
    expect(() => scenarioById('nope')).toThrow();
  });

  test.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('%s plays to its expected result', (_, scenario) => {
    const runs = runScenario(scenario, model);
    expect(runs.map((run) => run.member.id)).toEqual(CREW.map((member) => member.id));
    for (const run of runs) expect(run.samples).toHaveLength(SESSION_LENGTH);

    const alerts = scenarioAlerts(runs);
    const got = alerts.map((alert) => `${alert.crew}:${alert.cause}`).sort();
    expect(got).toEqual(scenario.expected.alerts.map((alert) => `${alert.crew}:${alert.cause}`).sort());
    expect(correlate(alerts)).toHaveLength(scenario.expected.incidents);
  });

  test('a scenario is the same every time it runs', () => {
    const scenario = scenarioById('sensor-drift');
    expect(runScenario(scenario, model)).toEqual(runScenario(scenario, model));
  });

  test('loose band: windows are discarded, with the reason, and nothing is scored', () => {
    const [cdr] = runScenario(scenarioById('loose-band'), model);
    const skipped = cdr.results.filter((result) => result.score === null);
    expect(skipped.length).toBeGreaterThan(4);
    expect(new Set(skipped.map((result) => result.quality.reason))).toEqual(new Set(['no-contact', 'motion']));
    expect(cdr.monitor.filter((step) => step.state === 'no-data')).toHaveLength(skipped.length);
  });

  test('sensor drift moves the reading and the optical channels, not skin temperature', () => {
    const options = { seed: 1, sensorDrift: { from: 90, bpmPerMinute: 6 } };
    const drifted = generateSession('usual', options);
    const clean = generateSession('usual', { seed: 1 });
    expect(drifted[80]).toEqual(clean[80]);
    expect(drifted[290].hr! - clean[290].hr!).toBeCloseTo(20, 0);
    expect(drifted[290].skinTemp).toBe(clean[290].skinTemp);
    expect(drifted[290].spectral![3]).toBeGreaterThan(clean[290].spectral![3]);
  });

  test('a slow drift and a cabin event move skin temperature with heart rate', () => {
    const clean = generateSession('usual', { seed: 1 });
    const slow = generateSession('usual', { seed: 1, slowDrift: { from: 30, bpmPerMinute: 2 } });
    const cabin = generateSession('usual', { seed: 1, cabin: { from: 170, to: 300, bpm: 14 } });
    expect(slow[270].hr! - clean[270].hr!).toBeCloseTo(8, 0);
    expect(slow[270].skinTemp!).toBeGreaterThan(clean[270].skinTemp!);
    expect(cabin[169]).toEqual(clean[169]);
    expect(cabin[240].hr! - clean[240].hr!).toBeCloseTo(14, 0);
    expect(cabin[240].skinTemp!).toBeGreaterThan(clean[240].skinTemp!);
  });

  test('the conjunction scenario sits inside a real blackout', () => {
    expect(blackoutOn(scenarioById('conjunction').link.missionDate)).not.toBeNull();
    expect(blackoutOn(scenarioById('usual').link.missionDate)).toBeNull();
  });
});