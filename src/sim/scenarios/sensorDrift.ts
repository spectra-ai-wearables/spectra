import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

export const sensorDrift: Scenario = {
  id: 'sensor-drift',
  label: 'Sensor fault or body change',
  description: 'One instrument drifts. One astronaut recovers slowly.',
  watch: 'Both raise an alert. The likely cause differs: sensor for one, physiological for the other.',
  focus: 'CDR',
  crew: { CDR: { sensorDrift: { from: 90, bpmPerMinute: 6 } }, PLT: { recoveryTau: 140 } },
  link: { missionDate: DEFAULT_DATE, startConnected: true },
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: {
    alerts: [
      { crew: 'CDR', cause: 'sensor' },
      { crew: 'PLT', cause: 'physiological' },
    ],
    incidents: 2,
  },
};