/** Runs a scenario for the whole crew: sessions, both detectors, monitors and likely causes. */
import { channelScores } from '../ml/channels';
import type { ChannelScore } from '../ml/channels';
import { analyzeWithModel } from '../ml/detector';
import type { Model } from '../ml/network';
import { analyzeSession } from './anomaly';
import { CAUSE_DETAIL, windowCause } from './cause';
import type { Cause } from './cause';
import { explain } from './explain';
import { generateSession } from './generator';
import type { Alert } from './incidents';
import { runMonitor } from './monitor';
import type { MonitorStep } from './monitor';
import { CREW } from './scenarios/types';
import type { CrewMember, Scenario } from './scenarios/types';
import type { Phase, Sample, WindowResult } from './types';

export interface CrewRun {
  member: CrewMember;
  samples: Sample[];
  /** Windows as read by the on-board model. */
  results: WindowResult[];
  /** The same windows as read by the statistical baseline. */
  baseline: WindowResult[];
  scores: Array<ChannelScore | null>;
  monitor: MonitorStep[];
  /** Likely kind of cause for each window, meaningful where the window deviates or is unreliable. */
  causes: Cause[];
}

const ALERT_TITLE: Record<Phase, string> = {
  rest: 'Heart rate outside resting pattern',
  exercise: 'Heart rate outside exercise pattern',
  recovery: 'Heart rate outside recovery pattern',
};

export function runScenario(scenario: Scenario, model: Model): CrewRun[] {
  const runs = CREW.map((member) => {
    const samples = generateSession('usual', { seed: member.seed, vary: true, ...scenario.crew[member.id] });
    const results = analyzeWithModel(samples, model);
    return {
      member,
      samples,
      results,
      baseline: analyzeSession(samples),
      scores: channelScores(samples, model),
      monitor: runMonitor(results),
      causes: [] as Cause[],
    };
  });

  for (const run of runs) {
    run.causes = run.results.map((result, index) => {
      const direction = Math.sign(result.score ?? 0);
      const together = runs.filter(
        (other) => other.results[index].deviating && Math.sign(other.results[index].score ?? 0) === direction,
      ).length;
      return windowCause(run.scores[index], result.quality, together, runs.length);
    });
  }
  return runs;
}

/** The alert a crew member's monitor raises at a window, or null when it raises none. */
export function alertAt(run: CrewRun, index: number): Alert | null {
  if (!run.monitor[index].raised) return null;
  const result = run.results[index];
  const cause = run.causes[index];
  return {
    id: `alert-${run.member.id}-${result.tStart}`,
    crew: run.member.id,
    createdAt: result.tEnd + 1,
    cause,
    title: ALERT_TITLE[result.phase],
    detail: `${explain(result).detail} ${CAUSE_DETAIL[cause]}`,
  };
}

export function scenarioAlerts(runs: CrewRun[]): Alert[] {
  return runs
    .flatMap((run) => run.results.flatMap((_, index) => alertAt(run, index) ?? []))
    .sort((a, b) => a.createdAt - b.createdAt);
}
