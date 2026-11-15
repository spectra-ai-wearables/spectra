export type ScenarioId = 'usual' | 'misplaced' | 'atypical';
export type Phase = 'rest' | 'exercise' | 'recovery';

export interface Sample {
  /** Seconds since the session started. */
  t: number;
  phase: Phase;
  contact: boolean;
  /** Beats per minute; null when the sensor has no reading. */
  hr: number | null;
  /** Skin temperature in °C; null when the sensor has no reading. */
  skinTemp: number | null;
  /** Normalized response (0..1) per spectral band; null without contact. */
  spectral: number[] | null;
  /** Motion intensity, 0..1. */
  motion: number;
}

export type QualityReason = 'ok' | 'no-contact' | 'missing-data' | 'motion';

export interface Quality {
  reliable: boolean;
  reason: QualityReason;
  /** Fraction of samples in the window with a heart-rate reading, 0..1. */
  usable: number;
}

export type ReadingState = 'within-pattern' | 'change-to-verify' | 'insufficient-data';

export interface WindowResult {
  tStart: number;
  tEnd: number;
  phase: Phase;
  quality: Quality;
  /** Signed deviation in units of the expected spread; null when unreliable. */
  score: number | null;
  /** Median heart-rate difference from the reference, in bpm; null when unreliable. */
  deviationBpm: number | null;
  deviating: boolean;
  /** Consecutive deviating windows, this one included. */
  streak: number;
  state: ReadingState;
}

export interface Explanation {
  state: ReadingState;
  label: string;
  detail: string;
  action: string;
}

export interface MissionEvent {
  id: string;
  createdAt: number;
  title: string;
  detail: string;
}

export type EventStage = 'saved' | 'waiting' | 'sending' | 'received';

export interface QueuedEvent {
  event: MissionEvent;
  stage: EventStage;
  sentAt: number | null;
  receivedAt: number | null;
}

export interface BaselineBand {
  expected: number;
  low: number;
  high: number;
}
