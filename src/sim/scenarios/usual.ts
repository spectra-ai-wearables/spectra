import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

export const usual: Scenario = {
  id: 'usual',
  label: 'Usual recovery',
  description: 'Four normal sessions.',
  watch: 'Nothing leaves the pattern, so almost nothing needs to be sent.',
  focus: 'CDR',
  crew: {},
  link: { missionDate: DEFAULT_DATE, startConnected: true },
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: { alerts: [], incidents: 0 },
};