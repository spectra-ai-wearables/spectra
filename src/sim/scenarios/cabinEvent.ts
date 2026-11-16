import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

const cabin = { from: 170, to: 340, bpm: 14 };

export const cabinEvent: Scenario = {
  id: 'cabin-event',
  label: 'Cabin event',
  description: 'All four astronauts drift up together.',
  watch: 'Four alerts become one incident, attributed to the cabin and not to a person.',
  focus: 'CDR',
  crew: { CDR: { cabin }, PLT: { cabin }, MS1: { cabin }, MS2: { cabin } },
  link: { missionDate: DEFAULT_DATE, startConnected: true },
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: {
    alerts: [
      { crew: 'CDR', cause: 'environment' },
      { crew: 'PLT', cause: 'environment' },
      { crew: 'MS1', cause: 'environment' },
      { crew: 'MS2', cause: 'environment' },
    ],
    incidents: 1,
  },
};