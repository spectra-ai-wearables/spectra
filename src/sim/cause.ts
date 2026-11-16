/**
 * Names the likely kind of cause behind a window, with fixed rules.
 *
 * It separates four cases: the wrist moved, the instrument is at fault,
 * the whole crew changed together, or one person's body changed. It does not
 * say what the change is, and it is not a diagnosis.
 */
import type { ChannelScore } from '../ml/channels';
import type { Quality } from './types';

export type Cause = 'movement' | 'sensor' | 'environment' | 'physiological';

/** Share of the crew that must deviate together to point at the cabin. */
export const CREW_SHARE = 0.75;
/** A heart-rate deviation at least this large, in spreads, is worth explaining. */
export const STRONG_Z = 3;
/** Skin temperature moving less than this share of the heart-rate deviation counts as unchanged. */
export const QUIET_RATIO = 0.4;

export const CAUSE_LABEL: Record<Cause, string> = {
  movement: 'Movement',
  sensor: 'Sensor',
  environment: 'Cabin environment',
  physiological: 'Physiological',
};

export const CAUSE_DETAIL: Record<Cause, string> = {
  movement: 'Movement is interfering with the optical reading.',
  sensor: 'The optical reading moved while skin temperature stayed on pattern. That points to the instrument, not the body.',
  environment: 'Most of the crew changed at the same time. That points to the cabin, not to one person.',
  physiological: 'Heart rate and skin temperature moved together for this astronaut only.',
};

export const CAUSE_ACTION: Record<Cause, string> = {
  movement: 'Hold your arm still for 30 seconds, then repeat the measurement.',
  sensor: 'Reseat the band and clean the sensor window, then repeat the measurement.',
  environment: 'Check cabin temperature and air quality before treating this as an individual change.',
  physiological: 'Confirm the measurement and log how you feel. If it continues, follow the on-board protocol.',
};

export function windowCause(
  score: ChannelScore | null,
  quality: Quality,
  crewDeviating: number,
  crewSize: number,
): Cause {
  if (score === null) return quality.reason === 'motion' ? 'movement' : 'sensor';
  if (crewSize > 1 && crewDeviating >= Math.max(2, Math.ceil(CREW_SHARE * crewSize))) return 'environment';
  if (Math.abs(score.z.hr) >= STRONG_Z && Math.abs(score.z.skinTemp) < QUIET_RATIO * Math.abs(score.z.hr)) return 'sensor';
  return 'physiological';
}
