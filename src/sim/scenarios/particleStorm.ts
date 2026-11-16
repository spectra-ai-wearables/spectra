import { latestParticleEvent } from '../sources/spaceWeather';
import { DEFAULT_DATE } from './types';
import type { Scenario } from './types';

const event = latestParticleEvent();

export const particleStorm: Scenario = {
  id: 'particle-storm',
  label: 'Solar particle event',
  description: 'A particle event degrades the link during the session.',
  watch: 'Packets are lost and the rate drops. Repair packets rebuild the alert on the ground without asking for a resend.',
  focus: 'PLT',
  crew: { PLT: { recoveryTau: 140 } },
  link: {
    missionDate: event?.time.slice(0, 10) ?? DEFAULT_DATE,
    startConnected: true,
    disturbance: { from: 90, to: 280, loss: 0.4, rateFactor: 0.01 },
  },
  basis: event
    ? {
        kind: 'data',
        text: `Date and onset from NASA DONKI event ${event.id}. The packet loss and rate are assumptions; readings are synthetic.`,
      }
    : { kind: 'synthetic', text: 'Synthetic readings and link conditions.' },
  expected: { alerts: [{ crew: 'PLT', cause: 'physiological' }], incidents: 1 },
};