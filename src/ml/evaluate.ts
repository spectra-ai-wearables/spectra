import { analyzeSession, median } from '../sim/anomaly';
import { EXERCISE_END, RECOVERY_TAU } from '../sim/baseline';
import type { WindowResult } from '../sim/types';
import { analyzeWithModel } from './detector';
import { SPLITS, referenceSessions } from './fit';
import type { Model } from './network';

export interface DetectorOutcome {
  /** Sessions in which the detector asked for verification. */
  alerts: number;
  /** Median seconds from the start of recovery to the alert; null without alerts. */
  medianDelay: number | null;
}

export interface EvaluationCase {
  id: string;
  label: string;
  recoveryTau: number;
  /** Whether an alert is the right outcome for this case. */
  alertExpected: boolean;
  sessions: number;
  baseline: DetectorOutcome;
  model: DetectorOutcome;
}

const CASES = [
  { id: 'usual', label: 'Usual recovery', recoveryTau: RECOVERY_TAU, alertExpected: false },
  { id: 'slight', label: 'Slightly slow recovery', recoveryTau: 50, alertExpected: true },
  { id: 'moderate', label: 'Moderately slow recovery', recoveryTau: 70, alertExpected: true },
  { id: 'marked', label: 'Markedly slow recovery', recoveryTau: 140, alertExpected: true },
];

function outcome(runs: WindowResult[][]): DetectorOutcome {
  const delays: number[] = [];
  for (const results of runs) {
    const first = results.find((r) => r.state === 'change-to-verify');
    if (first) delays.push(first.tEnd + 1 - EXERCISE_END);
  }
  return { alerts: delays.length, medianDelay: delays.length > 0 ? median(delays) : null };
}

/** Runs both detectors on held-out sessions that were never used for training or validation. */
export function evaluate(model: Model): EvaluationCase[] {
  return CASES.map((testCase, index) => {
    const sessions = referenceSessions(
      SPLITS.test.firstSeed + index * 10_000,
      SPLITS.test.sessions,
      testCase.recoveryTau,
    );
    return {
      ...testCase,
      sessions: sessions.length,
      baseline: outcome(sessions.map((session) => analyzeSession(session))),
      model: outcome(sessions.map((session) => analyzeWithModel(session, model))),
    };
  });
}
