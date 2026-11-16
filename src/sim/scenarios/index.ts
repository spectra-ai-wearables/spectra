import { atypicalRecovery } from './atypicalRecovery';
import { cabinEvent } from './cabinEvent';
import { conjunction } from './conjunction';
import { looseBand } from './looseBand';
import { particleStorm } from './particleStorm';
import { sensorDrift } from './sensorDrift';
import { serverRestart } from './serverRestart';
import { slowDrift } from './slowDrift';
import type { Scenario } from './types';
import { usual } from './usual';

export const SCENARIOS: Scenario[] = [
  usual,
  looseBand,
  atypicalRecovery,
  sensorDrift,
  slowDrift,
  cabinEvent,
  particleStorm,
  conjunction,
  serverRestart,
];

export function scenarioById(id: string): Scenario {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}`);
  return scenario;
}

export * from './types';