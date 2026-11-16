import { WINDOW_SIZE } from '../sim/anomaly';
import { assessQuality } from '../sim/quality';
import type { Sample } from '../sim/types';
import { windowResiduals } from './detector';
import type { Model } from './network';

/** One window's deviation from the model, per signal. */
export interface ChannelScore {
  /** Median difference from the prediction: bpm and °C. */
  residual: { hr: number; skinTemp: number };
  /** The same difference in units of the usual spread for that window. */
  z: { hr: number; skinTemp: number };
}

/** Per-signal deviation for every window; null where the window is unreliable. */
export function channelScores(samples: Sample[], model: Model): Array<ChannelScore | null> {
  const scores: Array<ChannelScore | null> = [];
  for (let start = 0; start + WINDOW_SIZE <= samples.length; start += WINDOW_SIZE) {
    const window = samples.slice(start, start + WINDOW_SIZE);
    if (!assessQuality(window).reliable) {
      scores.push(null);
      continue;
    }
    const position = Math.min(start / WINDOW_SIZE, model.spread.hr.length - 1);
    const residual = windowResiduals(window, model);
    scores.push({
      residual,
      z: {
        hr: residual.hr / model.spread.hr[position],
        skinTemp: residual.skinTemp / model.spread.skinTemp[position],
      },
    });
  }
  return scores;
}
