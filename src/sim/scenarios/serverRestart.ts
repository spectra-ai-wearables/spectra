import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

export const serverRestart: Scenario = {
  id: 'server-restart',
  label: 'Server restart',
  description: 'The on-board server restarts while an alert is in flight.',
  watch: 'The server resends what was not acknowledged. The ground drops the duplicate. Nothing is lost.',
  focus: 'PLT',
  crew: { PLT: { recoveryTau: 140 } },
  link: { missionDate: DEFAULT_DATE, startConnected: true },
  restartAt: 230,
  basis: { kind: 'synthetic', text: 'Synthetic readings.' },
  expected: { alerts: [{ crew: 'PLT', cause: 'physiological' }], incidents: 1 },
};