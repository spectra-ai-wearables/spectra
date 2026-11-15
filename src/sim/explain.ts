import { WINDOW_SIZE } from './anomaly';
import { BASELINE_SIGMA } from './baseline';
import type {
  Explanation,
  MissionEvent,
  Phase,
  QualityReason,
  ReadingState,
  WindowResult,
} from './types';

export const STATE_LABELS: Record<ReadingState, string> = {
  'within-pattern': 'Within your pattern',
  'change-to-verify': 'Change to verify',
  'insufficient-data': 'Not enough reliable data',
};

const PATTERN_NAME: Record<Phase, string> = {
  rest: 'resting pattern',
  exercise: 'exercise pattern',
  recovery: 'recovery pattern',
};

const WITHIN_DETAIL: Record<Phase, string> = {
  rest: 'Heart rate matches your resting pattern.',
  exercise: 'Heart rate is rising as expected for this activity.',
  recovery: 'Heart rate is returning toward rest along your recorded recovery pattern.',
};

const UNRELIABLE: Record<Exclude<QualityReason, 'ok'>, { detail: string; action: string }> = {
  'no-contact': {
    detail: 'The sensor lost skin contact, so this window was not analyzed.',
    action: 'Adjust the band until it sits flat on your wrist, then repeat the measurement.',
  },
  'missing-data': {
    detail: 'Too many readings are missing from this window, so it was not analyzed.',
    action: 'Keep the band on and repeat the measurement.',
  },
  motion: {
    detail: 'Movement is interfering with the optical reading, so this window was not analyzed.',
    action: 'Hold your arm still for 30 seconds, then repeat the measurement.',
  },
};

export function explain(result: WindowResult): Explanation {
  const { state } = result;
  const label = STATE_LABELS[state];

  if (state === 'insufficient-data') {
    const reason = result.quality.reason === 'ok' ? 'missing-data' : result.quality.reason;
    return { state, label, ...UNRELIABLE[reason] };
  }

  if (state === 'change-to-verify') {
    const score = result.score ?? 0;
    const direction = score >= 0 ? 'above' : 'below';
    const bpm = Math.round(Math.abs(score) * BASELINE_SIGMA);
    const seconds = result.streak * WINDOW_SIZE;
    return {
      state,
      label,
      detail:
        `Heart rate has stayed about ${bpm} bpm ${direction} your recorded ` +
        `${PATTERN_NAME[result.phase]} for ${seconds} seconds. Signal quality is good.`,
      action:
        'Confirm the measurement and log how you feel. If it continues, follow the on-board protocol.',
    };
  }

  if (result.deviating) {
    return {
      state,
      label,
      detail: `A reading is outside your ${PATTERN_NAME[result.phase]}. Spectra is watching whether it persists.`,
      action: 'No action needed.',
    };
  }

  return { state, label, detail: WITHIN_DETAIL[result.phase], action: 'No action needed.' };
}

const EVENT_TITLE: Record<Phase, string> = {
  rest: 'Heart rate outside resting pattern',
  exercise: 'Heart rate outside exercise pattern',
  recovery: 'Heart rate outside recovery pattern',
};

export function toEvent(result: WindowResult, explanation: Explanation): MissionEvent {
  return {
    id: `evt-${result.tStart}`,
    createdAt: result.tEnd + 1,
    title: EVENT_TITLE[result.phase],
    detail: explanation.detail,
  };
}
