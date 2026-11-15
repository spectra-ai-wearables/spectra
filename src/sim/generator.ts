import {
  EXERCISE_HR,
  RECOVERY_TAU,
  RESTING_HR,
  SESSION_LENGTH,
  expectedHr,
  phaseAt,
} from './baseline';
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const inRange = (range: Range | null, t: number) =>
  range !== null && t >= range[0] && t < range[1];

export function generateSession(scenario: ScenarioId): Sample[] {
  const config = SCENARIOS[scenario];
  const random = mulberry32(config.seed);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  const samples: Sample[] = [];
  for (let t = 0; t < SESSION_LENGTH; t++) {
    const phase = phaseAt(t);
    // Draw every noise value on every step so the sequence stays aligned.
    const hrNoise = gauss();
    const tempNoise = gauss();
    const motionNoise = gauss();
    const spectralNoise = SPECTRAL_BASE.map(() => gauss());

    const artifact = inRange(config.motionArtifact, t);
    const motion = round(
      clamp01((artifact ? 0.95 : PHASE_MOTION[phase]) + 0.03 * motionNoise),
      3,
    );

    if (inRange(config.noContact, t)) {
      samples.push({ t, phase, contact: false, hr: null, skinTemp: null, spectral: null, motion });
      continue;
    }

    const trueHr = expectedHr(t, config.recoveryTau);
    const effort = (trueHr - RESTING_HR) / (EXERCISE_HR - RESTING_HR);
    samples.push({
      t,
      phase,
      contact: true,
      hr: round(trueHr + (artifact ? 15 : 2) * hrNoise, 1),
      skinTemp: round(33.4 + 1.1 * effort + 0.05 * tempNoise, 2),
      spectral: SPECTRAL_BASE.map((base, i) =>
        round(clamp01(base * (1 + 0.12 * effort) + 0.01 * spectralNoise[i]), 3),
      ),
      motion,
    });
  }
  return samples;
}
