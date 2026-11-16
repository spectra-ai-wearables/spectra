import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

export const slowDrift: Scenario = {
  id: 'slow-drift',
  label: 'Slow drift',
  description: 'Heart rate creeps away from the reference, 2 bpm per minute.',
  watch: 'A warning comes first and holds while small deviations add up. The alert follows once three windows in a row leave the pattern.',
  focus: 'MS2',
  crew: { MS2: { slowDrift: { from: 30, bpmPerMinute: 2 } } },
  link: { missionDate: DEFAULT_DATE, startConnected: true },
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: { alerts: [{ crew: 'MS2', cause: 'physiological' }], incidents: 1 },
};