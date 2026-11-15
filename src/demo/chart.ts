import { EXERCISE_END, REST_END, SESSION_LENGTH, baselineAt } from '../sim/baseline';
import type { Sample } from '../sim/types';

/** SVG viewBox and plot margins. */
export const CHART = {
  width: 640,
  height: 240,
  left: 40,
  right: 12,
  top: 12,
  bottom: 28,
  minHr: 40,
  maxHr: 160,
} as const;

export const PHASE_MARKS = [
  { t: 0, label: 'Rest' },
  { t: REST_END, label: 'Exercise' },
  { t: EXERCISE_END, label: 'Recovery' },
];

export function xAt(t: number): number {
  return CHART.left + (t / SESSION_LENGTH) * (CHART.width - CHART.left - CHART.right);
}

export function yAt(hr: number): number {
  const clamped = Math.min(CHART.maxHr, Math.max(CHART.minHr, hr));
  const ratio = (clamped - CHART.minHr) / (CHART.maxHr - CHART.minHr);
  return CHART.top + (1 - ratio) * (CHART.height - CHART.top - CHART.bottom);
}

const point = (t: number, hr: number) => `${xAt(t).toFixed(1)} ${yAt(hr).toFixed(1)}`;

/** Heart-rate line; the pen lifts wherever a reading is missing. */
export function linePath(samples: Sample[]): string {
  let d = '';
  let penDown = false;
  for (const s of samples) {
    if (s.hr === null) {
      penDown = false;
      continue;
    }
    d += `${penDown ? 'L' : 'M'}${point(s.t, s.hr)}`;
    penDown = true;
  }
  return d;
}

/** Closed outline of the individual baseline band over the whole session. */
export function bandPath(step = 5): string {
  const times: number[] = [];
  for (let t = 0; t <= SESSION_LENGTH; t += step) times.push(t);
  const upper = times.map((t) => point(t, baselineAt(t).high));
  const lower = [...times].reverse().map((t) => point(t, baselineAt(t).low));
  return `M${[...upper, ...lower].join('L')}Z`;
}
