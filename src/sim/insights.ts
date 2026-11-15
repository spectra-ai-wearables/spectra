import { median } from './anomaly';
import { EXERCISE_END, expectedHr } from './baseline';
import { formatClock } from './format';
import type { QualityReason, QueuedEvent, Sample, WindowResult } from './types';

export interface Insight {
  title: string;
  value: string;
  detail: string;
}

const SKIP_REASON: Record<Exclude<QualityReason, 'ok'>, string> = {
  'no-contact': 'no skin contact',
  'missing-data': 'missing readings',
  motion: 'movement',
};

/** Median heart rate over [from, to), or null when too few readings are valid. */
function heartRateAround(samples: Sample[], from: number, to: number): number | null {
  const values = samples.flatMap((s) => (s.t >= from && s.t < to && s.hr !== null ? [s.hr] : []));
  return values.length >= 5 ? median(values) : null;
}

/**
 * Plain-language summary of a session so far. Everything is computed from the
 * session's own readings with fixed rules; nothing here is a diagnosis.
 */
export function sessionInsights(
  samples: Sample[],
  results: WindowResult[],
  events: QueuedEvent[],
): Insight[] {
  if (results.length === 0) {
    return [
      {
        title: 'Not enough data',
        value: 'Awaiting data',
        detail: 'Spectra needs one complete ten-second window before it can summarize the session.',
      },
    ];
  }

  const insights: Insight[] = [];

  // Reliability
  const skipped = results.filter((r) => !r.quality.reliable);
  const usable = results.length - skipped.length;
  const reasons = (Object.keys(SKIP_REASON) as Array<keyof typeof SKIP_REASON>)
    .map((reason) => ({ reason, count: skipped.filter((r) => r.quality.reason === reason).length }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} for ${SKIP_REASON[entry.reason]}`);
  insights.push({
    title: 'Data reliability',
    value: `${Math.round((usable / results.length) * 100)}%`,
    detail:
      skipped.length === 0
        ? `All ${results.length} windows so far were usable.`
        : `${usable} of ${results.length} windows were usable; skipped ${reasons.join(', ')}. Skipped windows are never scored.`,
  });

  // Peak heart rate
  const valid = samples.filter((s) => s.hr !== null);
  if (valid.length > 0) {
    const peak = valid.reduce((best, s) => ((s.hr as number) > (best.hr as number) ? s : best));
    insights.push({
      title: 'Peak heart rate',
      value: `${Math.round(peak.hr as number)} bpm`,
      detail: `Reached at ${formatClock(peak.t)}, during ${peak.phase}.`,
    });
  }

  // Heart-rate recovery in the first minute after exercise
  const reference = Math.round(expectedHr(EXERCISE_END - 5) - expectedHr(EXERCISE_END + 60));
  if (samples.length < EXERCISE_END + 65) {
    insights.push({
      title: 'One-minute recovery',
      value: 'Not reached',
      detail: 'The session has not reached one minute of recovery yet.',
    });
  } else {
    const atEnd = heartRateAround(samples, EXERCISE_END - 10, EXERCISE_END);
    const later = heartRateAround(samples, EXERCISE_END + 55, EXERCISE_END + 65);
    insights.push(
      atEnd === null || later === null
        ? {
            title: 'One-minute recovery',
            value: 'Unavailable',
            detail: 'Readings around the first minute of recovery were not reliable enough to measure this.',
          }
        : {
            title: 'One-minute recovery',
            value: `${Math.round(atEnd - later)} bpm`,
            detail: `Heart rate fell ${Math.round(atEnd - later)} bpm in the first minute after exercise. Your reference for this activity is about ${reference} bpm.`,
          },
    );
  }

  // Largest deviation
  const scored = results.filter((r) => r.score !== null);
  if (scored.length > 0) {
    const top = scored.reduce((best, r) =>
      Math.abs(r.score as number) > Math.abs(best.score as number) ? r : best,
    );
    const firstCheck = results.find((r) => r.state === 'change-to-verify');
    const size = `${Math.abs(top.score as number).toFixed(1)} times your usual variation`;
    insights.push({
      title: 'Deviation from your pattern',
      value: firstCheck ? 'Check requested' : 'No check needed',
      detail: firstCheck
        ? `The largest deviation was ${size}, in the window ending ${formatClock(top.tEnd + 1)}. It persisted, so Spectra asked for a check at ${formatClock(firstCheck.tEnd + 1)}.`
        : `The largest deviation was ${size}, in the window ending ${formatClock(top.tEnd + 1)}. Nothing persisted long enough to ask for a check.`,
    });
  }

  // Skin temperature
  const temps = samples.flatMap((s) => (s.skinTemp === null ? [] : [s.skinTemp]));
  if (temps.length > 0) {
    insights.push({
      title: 'Skin temperature',
      value: `${Math.min(...temps).toFixed(1)} to ${Math.max(...temps).toFixed(1)} °C`,
      detail: 'Range across the session so far. This is skin temperature, not core body temperature.',
    });
  }

  // Ground link
  if (events.length > 0) {
    const received = events.filter((e) => e.stage === 'received').length;
    const pending = events.length - received;
    insights.push({
      title: 'Ground link',
      value: `${received} of ${events.length} received`,
      detail:
        pending === 0
          ? 'Every event from this session has reached the ground team.'
          : `${pending} ${pending === 1 ? 'event is' : 'events are'} saved on board and will be sent when the link allows.`,
    });
  }

  return insights;
}
