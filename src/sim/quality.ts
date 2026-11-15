import type { Quality, Sample } from './types';

export const MIN_CONTACT = 0.8;
export const MIN_VALID = 0.8;
export const MAX_MOTION = 0.85;

export function assessQuality(window: Sample[]): Quality {
  const count = window.length;
  if (count === 0) return { reliable: false, reason: 'missing-data', usable: 0 };

  const contact = window.filter((s) => s.contact).length / count;
  const usable = window.filter((s) => s.hr !== null).length / count;
  const motion = window.reduce((sum, s) => sum + s.motion, 0) / count;

  if (contact < MIN_CONTACT) return { reliable: false, reason: 'no-contact', usable };
  if (usable < MIN_VALID) return { reliable: false, reason: 'missing-data', usable };
  if (motion > MAX_MOTION) return { reliable: false, reason: 'motion', usable };
  return { reliable: true, reason: 'ok', usable };
}
