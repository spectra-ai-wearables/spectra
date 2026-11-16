/**
 * Turns a stream of window results into a monitor with a steady state.
 *
 * Only persistence raises an alert: several deviating windows in a row. A
 * CUSUM adds up smaller deviations that share a direction and raises a
 * warning, so a slow drift shows up before any single window stands out.
 * Hysteresis keeps the state from flickering on the way back down.
 */
import type { WindowResult } from './types';

export type MonitorState = 'ok' | 'warn' | 'alert' | 'no-data';

export interface MonitorStep {
  state: MonitorState;
  /** Larger of the upward and downward sums; 0 while nothing is accumulating. */
  cusum: number;
  /** True on the window where the monitor entered the alert state. */
  raised: boolean;
  /** True while the warning comes from the trend and not from a deviating window. */
  trending: boolean;
}

/** Deviation, in spreads, that a window may carry without adding to the sum. */
export const CUSUM_SLACK = 2;
/**
 * Sum at which the trend becomes a warning. Measured on synthetic sessions:
 * 4 of the 300 held-out normal sessions reach it, which is why the trend only
 * warns. On 100 sessions drifting 3 bpm per minute it was reached in all of
 * them, and in 72 before three windows in a row had deviated. It rarely
 * precedes the first deviating window; its use is to hold the warning while
 * deviations come and go.
 */
export const CUSUM_WARN = 4;
/** Calm windows in a row needed before the state steps down. */
export const CLEAR_WINDOWS = 3;

type Level = Exclude<MonitorState, 'no-data'>;
const RANK: Record<Level, number> = { ok: 0, warn: 1, alert: 2 };

/** Upward and downward CUSUM of the signed score; unreliable windows leave it unchanged. */
export function cusumSeries(results: WindowResult[], slack: number = CUSUM_SLACK): number[] {
  let up = 0;
  let down = 0;
  return results.map((result) => {
    if (result.score !== null) {
      up = Math.max(0, up + result.score - slack);
      down = Math.max(0, down - result.score - slack);
    }
    return Math.max(up, down);
  });
}

export function runMonitor(results: WindowResult[]): MonitorStep[] {
  const sums = cusumSeries(results);
  let latched: Level = 'ok';
  let calm = 0;

  return results.map((result, index) => {
    const cusum = sums[index];
    const trend = cusum >= CUSUM_WARN;
    if (result.state === 'insufficient-data') return { state: 'no-data', cusum, raised: false, trending: false };

    const level: Level = result.state === 'change-to-verify' ? 'alert' : result.deviating || trend ? 'warn' : 'ok';
    let raised = false;
    if (RANK[level] >= RANK[latched]) {
      raised = level === 'alert' && latched !== 'alert';
      latched = level;
      calm = 0;
    } else {
      calm += 1;
      if (calm >= CLEAR_WINDOWS) {
        latched = level;
        calm = 0;
      }
    }
    return { state: latched, cusum, raised, trending: latched === 'warn' && trend && !result.deviating };
  });
}
