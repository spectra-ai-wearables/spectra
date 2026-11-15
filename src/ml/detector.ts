import { PERSISTENCE, WINDOW_SIZE, median } from '../sim/anomaly';
import { assessQuality } from '../sim/quality';
import type { Sample, WindowResult } from '../sim/types';
import { predict } from './network';
import type { Model } from './network';

export interface WindowResiduals {
  hr: number;
  skinTemp: number;
}

/** Median difference between what was measured and what the model predicted for a window. */
export function windowResiduals(window: Sample[], model: Model): WindowResiduals {
  const hr: number[] = [];
  const skinTemp: number[] = [];
  for (const sample of window) {
    if (sample.hr === null || sample.skinTemp === null) continue;
    const expected = predict(model.layers, sample.t);
    hr.push(sample.hr - expected.hr);
    skinTemp.push(sample.skinTemp - expected.skinTemp);
  }
  return { hr: median(hr), skinTemp: median(skinTemp) };
}

/**
 * Same pipeline as the statistical baseline (quality gate, score, persistence),
 * with the reference and its spread learned by the model instead of written by hand.
 */
export function analyzeWithModel(samples: Sample[], model: Model): WindowResult[] {
  const results: WindowResult[] = [];
  let streak = 0;

  for (let start = 0; start + WINDOW_SIZE <= samples.length; start += WINDOW_SIZE) {
    const window = samples.slice(start, start + WINDOW_SIZE);
    const frame = {
      tStart: window[0].t,
      tEnd: window[window.length - 1].t,
      phase: window[window.length - 1].phase,
      quality: assessQuality(window),
    };

    if (!frame.quality.reliable) {
      streak = 0;
      results.push({
        ...frame,
        score: null,
        deviationBpm: null,
        deviating: false,
        streak,
        state: 'insufficient-data',
      });
      continue;
    }

    const position = Math.min(Math.floor(frame.tStart / WINDOW_SIZE), model.spread.hr.length - 1);
    const residuals = windowResiduals(window, model);
    const zHr = residuals.hr / model.spread.hr[position];
    const zTemp = residuals.skinTemp / model.spread.skinTemp[position];
    const magnitude = Math.sqrt((zHr * zHr + zTemp * zTemp) / 2);
    const deviating = magnitude >= model.threshold;
    streak = deviating ? streak + 1 : 0;

    results.push({
      ...frame,
      score: zHr < 0 ? -magnitude : magnitude,
      deviationBpm: residuals.hr,
      deviating,
      streak,
      state: streak >= PERSISTENCE ? 'change-to-verify' : 'within-pattern',
    });
  }
  return results;
}
