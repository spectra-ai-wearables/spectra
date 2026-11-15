import { BASELINE_SIGMA, expectedHr } from './baseline';
import { assessQuality } from './quality';
import type { Sample, WindowResult } from './types';

export const WINDOW_SIZE = 10;
/** A window deviates when its median residual is at least this many sigmas. */
export const DEVIATION_THRESHOLD = 3;
/** Consecutive deviating windows required before the user is asked to verify. */
export const PERSISTENCE = 3;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function analyzeSession(samples: Sample[]): WindowResult[] {
  const results: WindowResult[] = [];
  let streak = 0;

  for (let start = 0; start + WINDOW_SIZE <= samples.length; start += WINDOW_SIZE) {
    const window = samples.slice(start, start + WINDOW_SIZE);
    const frame = {
      tStart: window[0].t,
      tEnd: window[window.length - 1].t,
      phase: window[window.length - 1].phase,
      quality: assessQuality(window),
    };

    if (!frame.quality.reliable) {
      streak = 0;
      results.push({
        ...frame,
        score: null,
        deviationBpm: null,
        deviating: false,
        streak,
        state: 'insufficient-data',
      });
      continue;
    }

    const residuals = window.flatMap((s) => (s.hr === null ? [] : [s.hr - expectedHr(s.t)]));
    const deviationBpm = median(residuals);
    const score = deviationBpm / BASELINE_SIGMA;
    const deviating = Math.abs(score) >= DEVIATION_THRESHOLD;
    streak = deviating ? streak + 1 : 0;
    results.push({
      ...frame,
      score,
      deviationBpm,
      deviating,
      streak,
      state: streak >= PERSISTENCE ? 'change-to-verify' : 'within-pattern',
    });
  }
  return results;
}
