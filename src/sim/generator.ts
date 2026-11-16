import {
  EXERCISE_HR,
  RECOVERY_TAU,
  RESTING_HR,
  SESSION_LENGTH,
  expectedHr,
  phaseAt,
} from './baseline';
import { gaussian, mulberry32 } from './random';
import type { Phase, Sample, ScenarioId } from './types';

type Range = readonly [start: number, end: number];

interface ScenarioConfig {
  seed: number;
  recoveryTau: number;
  noContact: Range | null;
  motionArtifact: Range | null;
}

const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  usual: { seed: 11, recoveryTau: RECOVERY_TAU, noContact: null, motionArtifact: null },
  misplaced: {
    seed: 23,
    recoveryTau: RECOVERY_TAU,
    noContact: [170, 215],
    motionArtifact: [215, 240],
  },
  atypical: { seed: 37, recoveryTau: 140, noContact: null, motionArtifact: null },
};

/** Center wavelength of each simulated spectral band, in nanometers. */
export const SPECTRAL_BANDS_NM = [415, 445, 480, 515, 555, 590, 630, 680];
const SPECTRAL_BASE = [0.18, 0.26, 0.35, 0.47, 0.58, 0.66, 0.52, 0.4];

const PHASE_MOTION: Record<Phase, number> = { rest: 0.05, exercise: 0.6, recovery: 0.08 };

export interface SessionOptions {
  /** Overrides the scenario's fixed seed, to produce a different session. */
  seed?: number;
  /** Overrides the scenario's recovery time constant, in seconds. */
  recoveryTau?: number;
  /**
   * Adds session-to-session variation: the same person does not recover in
   * exactly the same way twice. Off by default so the demo scenarios stay fixed.
   */
  vary?: boolean;
  /** The band loses skin contact over this stretch of the session. */
  noContact?: Range;
  /** Movement swamps the optical reading over this stretch. */
  motionArtifact?: Range;
  /** The instrument drifts: the heart-rate reading gains a bias the body does not have. */
  sensorDrift?: Drift;
  /** The body drifts: the true heart rate moves away from the reference, slowly. */
  slowDrift?: Drift;
  /** Something in the cabin raises everyone's heart rate over this stretch. */
  cabin?: { from: number; to: number; bpm: number };
}

export interface Drift {
  from: number;
  bpmPerMinute: number;
}

/** Seconds a cabin-wide change takes to build up and to fade. */
const CABIN_RAMP = 20;

const driftAt = (drift: Drift | undefined, t: number) =>
  drift && t > drift.from ? ((t - drift.from) / 60) * drift.bpmPerMinute : 0;

function cabinAt(cabin: SessionOptions['cabin'], t: number): number {
  if (!cabin || t < cabin.from || t >= cabin.to) return 0;
  const ramp = Math.min(1, (t - cabin.from) / CABIN_RAMP, (cabin.to - t) / CABIN_RAMP);
  return cabin.bpm * ramp;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const inRange = (range: Range | null, t: number) =>
  range !== null && t >= range[0] && t < range[1];

export function generateSession(scenario: ScenarioId, options: SessionOptions = {}): Sample[] {
  const config = SCENARIOS[scenario];
  const seed = options.seed ?? config.seed;
  const gauss = gaussian(mulberry32(seed));

  // Variation uses its own stream so it never shifts the measurement noise.
  let recoveryTau = options.recoveryTau ?? config.recoveryTau;
  let restingOffset = 0;
  if (options.vary) {
    const random = mulberry32(seed ^ 0x9e3779b9);
    recoveryTau *= 0.85 + 0.3 * random();
    restingOffset = 1.5 * gaussian(random)();
  }

  const samples: Sample[] = [];
  for (let t = 0; t < SESSION_LENGTH; t++) {
    const phase = phaseAt(t);
    // Draw every noise value on every step so the sequence stays aligned.
    const hrNoise = gauss();
    const tempNoise = gauss();
    const motionNoise = gauss();
    const spectralNoise = SPECTRAL_BASE.map(() => gauss());

    const artifact = inRange(options.motionArtifact ?? config.motionArtifact, t);
    const motion = round(
      clamp01((artifact ? 0.95 : PHASE_MOTION[phase]) + 0.03 * motionNoise),
      3,
    );

    if (inRange(options.noContact ?? config.noContact, t)) {
      samples.push({ t, phase, contact: false, hr: null, skinTemp: null, spectral: null, motion });
      continue;
    }

    const trueHr =
      expectedHr(t, recoveryTau) + restingOffset + driftAt(options.slowDrift, t) + cabinAt(options.cabin, t);
    const effort = (trueHr - RESTING_HR) / (EXERCISE_HR - RESTING_HR);
    // A drifting instrument biases the optical channels; the body is unchanged.
    const bias = driftAt(options.sensorDrift, t);
    const gain = 1 + 0.12 * effort + bias / 100;
    samples.push({
      t,
      phase,
      contact: true,
      hr: round(trueHr + bias + (artifact ? 15 : 2) * hrNoise, 1),
      skinTemp: round(33.4 + 1.1 * effort + 0.05 * tempNoise, 2),
      spectral: SPECTRAL_BASE.map((base, i) =>
        round(clamp01(base * gain + 0.01 * spectralNoise[i]), 3),
      ),
      motion,
    });
  }
  return samples;
}
