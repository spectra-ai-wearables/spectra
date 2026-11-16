import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

export const atypicalRecovery: Scenario = {
  id: 'atypical-recovery',
  label: 'Atypical recovery, no link',
  description: 'Heart rate recovers slowly while the link is off.',
  watch: 'The alert is raised on board and waits. Switch the link on to deliver it.',
  focus: 'CDR',
  crew: { CDR: { recoveryTau: 140 } },
  link: { missionDate: DEFAULT_DATE, startConnected: false },
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: { alerts: [{ crew: 'CDR', cause: 'physiological' }], incidents: 1 },
};