import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

export const looseBand: Scenario = {
  id: 'loose-band',
  label: 'Loose band',
  description: 'The band slips, then the arm moves.',
  watch: 'Unreliable windows are discarded, never scored. No alert is raised.',
  focus: 'CDR',
  crew: { CDR: { noContact: [170, 215], motionArtifact: [215, 240] } },
  link: { missionDate: DEFAULT_DATE, startConnected: true },
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: { alerts: [], incidents: 0 },
};