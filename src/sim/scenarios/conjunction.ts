import { blackouts } from '../sources/horizons';
import type { Scenario } from './types';

const DAY_MS = 86_400_000;
const window = blackouts().at(-1)!;
/** A day in the middle of the blackout. */
const middle = new Date((Date.parse(window.start) + Date.parse(window.end)) / 2);
const date = new Date(Math.floor(middle.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);

export const conjunction: Scenario = {
  id: 'conjunction',
  label: 'Solar conjunction',
  description: `The Sun sits between Earth and Mars. No link for ${window.days} days.`,
  watch: 'Everything is kept on board. Advance to the end of the blackout: the alert leaves first.',
  focus: 'CDR',
  crew: { CDR: { recoveryTau: 140 } },
  link: { missionDate: date, startConnected: true },
  basis: {
    kind: 'data',
    text: `Blackout from ${window.start} to ${window.end}, from the JPL Horizons ephemeris. Readings are synthetic.`,
  },
  expected: { alerts: [{ crew: 'CDR', cause: 'physiological' }], incidents: 1 },
};