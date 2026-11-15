import type { BaselineBand, Phase } from './types';

export const REST_END = 60;
export const EXERCISE_END = 150;
export const SESSION_LENGTH = 300;

export const RESTING_HR = 62;
export const EXERCISE_HR = 135;
export const EXERCISE_TAU = 20;
/** Time constant of this user's recorded recovery, in seconds. */
export const RECOVERY_TAU = 35;
/** Typical spread of this user's heart rate around the reference, in bpm. */
export const BASELINE_SIGMA = 4;
export const BAND_SIGMAS = 3;

export function phaseAt(t: number): Phase {
  if (t < REST_END) return 'rest';
  if (t < EXERCISE_END) return 'exercise';
  return 'recovery';
}

function exerciseHr(t: number): number {
  const rise = 1 - Math.exp(-(t - REST_END) / EXERCISE_TAU);
  return RESTING_HR + (EXERCISE_HR - RESTING_HR) * rise;
}

export function expectedHr(t: number, recoveryTau: number = RECOVERY_TAU): number {
  if (t < REST_END) return RESTING_HR;
  if (t < EXERCISE_END) return exerciseHr(t);
  const peak = exerciseHr(EXERCISE_END);
  return RESTING_HR + (peak - RESTING_HR) * Math.exp(-(t - EXERCISE_END) / recoveryTau);
}

export function baselineAt(t: number): BaselineBand {
  const expected = expectedHr(t);
  const margin = BAND_SIGMAS * BASELINE_SIGMA;
  return { expected, low: expected - margin, high: expected + margin };
}
