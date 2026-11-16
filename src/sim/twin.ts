/**
 * Send the surprise, not the signal.
 *
 * The ground keeps a copy of each astronaut's reference model. The server
 * sends only what that copy could not have predicted: the residual of a window
 * that left the dead band, or a note that a window had no reliable data. A
 * heartbeat confirms that everything else matched. Past the last heartbeat the
 * ground keeps projecting, with a band that widens until news arrives.
 */
import type { ChannelScore } from '../ml/channels';
import { predict } from '../ml/network';
import type { Model } from '../ml/network';
import { WINDOW_SIZE } from './anomaly';

/** Heart rate (2), skin temperature (2), eight spectral bands (8), motion (1), flags (1), time (2). */
export const RAW_SAMPLE_BYTES = 16;
export const RAW_WINDOW_BYTES = RAW_SAMPLE_BYTES * WINDOW_SIZE;
/** Crew (1), window (2), heart-rate and temperature residuals (1 + 1), flags (1), check (2). */
export const RESIDUAL_BYTES = 8;
export const GAP_BYTES = 4;
export const HEARTBEAT_BYTES = 4;
/** Crew, time, state, both scores, likely cause, and the hash of the ledger record. */
export const ALERT_BYTES = 96;
/** Assumed size of the bundle headers and the integrity block around a payload. */
export const BUNDLE_OVERHEAD_BYTES = 48;

/** A window stays unsent while both signals are within this many spreads. */
export const DEAD_BAND = 2;
export const HR_STEP = 0.5;
export const TEMP_STEP = 0.02;
/** How fast the projected band widens, in spreads per window without news. */
export const BAND_GROWTH = 0.5;
export const BAND_LIMIT = 12;

export type TwinRecord =
  | { kind: 'residual'; w: number; hr: number; temp: number }
  | { kind: 'gap'; w: number };

const quantize = (value: number, step: number) => Math.max(-127, Math.min(127, Math.round(value / step)));

/** What the server sends for one window, or null when the ground can predict it. */
export function encodeWindow(index: number, score: ChannelScore | null): TwinRecord | null {
  if (score === null) return { kind: 'gap', w: index };
  if (Math.abs(score.z.hr) < DEAD_BAND && Math.abs(score.z.skinTemp) < DEAD_BAND) return null;
  return {
    kind: 'residual',
    w: index,
    hr: quantize(score.residual.hr, HR_STEP),
    temp: quantize(score.residual.skinTemp, TEMP_STEP),
  };
}

export function recordBytes(record: TwinRecord): number {
  return record.kind === 'residual' ? RESIDUAL_BYTES : GAP_BYTES;
}

export type TwinBasis = 'reported' | 'predicted' | 'projected' | 'gap';

export interface TwinEstimate {
  w: number;
  basis: TwinBasis;
  /** Heart rate as the ground sees it; null for a window reported as unreliable. */
  hr: number | null;
  low: number | null;
  high: number | null;
}

export interface Twin {
  apply(record: TwinRecord): void;
  /** Everything up to this window that was not reported matched the prediction. */
  confirm(through: number): void;
  confirmedThrough(): number;
  estimate(w: number): TwinEstimate;
}

export function createTwin(model: Model): Twin {
  const records = new Map<number, TwinRecord>();
  let confirmed = -1;

  const expected = (w: number) => predict(model.layers, w * WINDOW_SIZE + WINDOW_SIZE / 2).hr;
  const spread = (w: number) => model.spread.hr[Math.min(w, model.spread.hr.length - 1)];

  return {
    apply(record) {
      records.set(record.w, record);
    },
    confirm(through) {
      confirmed = Math.max(confirmed, through);
    },
    confirmedThrough: () => confirmed,
    estimate(w) {
      const record = records.get(w);
      if (record?.kind === 'gap') return { w, basis: 'gap', hr: null, low: null, high: null };
      if (record?.kind === 'residual') {
        const hr = expected(w) + record.hr * HR_STEP;
        return { w, basis: 'reported', hr, low: hr - spread(w), high: hr + spread(w) };
      }
      if (w <= confirmed) {
        const hr = expected(w);
        const margin = DEAD_BAND * spread(w);
        return { w, basis: 'predicted', hr, low: hr - margin, high: hr + margin };
      }
      // No news yet: carry the last reported residual forward and widen the band.
      const last = records.get(confirmed);
      const carried = last?.kind === 'residual' ? last.hr * HR_STEP : 0;
      const hr = expected(w) + carried;
      const margin = Math.min(BAND_LIMIT, DEAD_BAND + BAND_GROWTH * (w - confirmed)) * spread(w);
      return { w, basis: 'projected', hr, low: hr - margin, high: hr + margin };
    },
  };
}
