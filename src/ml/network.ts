import { EXERCISE_END, EXERCISE_HR, REST_END, RESTING_HR, SESSION_LENGTH } from '../sim/baseline';

export interface Layer {
  /** weights[output][input] */
  weights: number[][];
  biases: number[];
}

export interface Model {
  layers: Layer[];
  /**
   * Typical size of a normal window's deviation from the prediction, one value
   * per window position in the session. Learned from validation sessions.
   */
  spread: { hr: number[]; skinTemp: number[] };
  /** A window deviates when its combined score reaches this many spreads. */
  threshold: number;
  training: {
    sessions: number;
    validationSessions: number;
    epochs: number;
    parameters: number;
    loss: number;
  };
}

export interface Prediction {
  hr: number;
  skinTemp: number;
}

/** Scale used to bring skin temperature (°C) into the same range as the other values. */
const SKIN_TEMP_REFERENCE = 33.4;
const SKIN_TEMP_RANGE = 1.1;

/** Fully connected network: tanh on hidden layers, linear output. */
export function forward(layers: Layer[], input: number[]): number[] {
  let activation = input;
  layers.forEach((layer, index) => {
    const isOutput = index === layers.length - 1;
    const previous = activation;
    activation = layer.weights.map((row, j) => {
      let sum = layer.biases[j];
      for (let k = 0; k < row.length; k++) sum += row[k] * previous[k];
      return isOutput ? sum : Math.tanh(sum);
    });
  });
  return activation;
}

/**
 * What the model knows about a moment: where it falls in the planned activity.
 * It is never given the expected heart rate; it has to learn that from sessions.
 */
export function contextFeatures(t: number): number[] {
  const rest = t < REST_END;
  const exercise = !rest && t < EXERCISE_END;
  const start = rest ? 0 : exercise ? REST_END : EXERCISE_END;
  const end = rest ? REST_END : exercise ? EXERCISE_END : SESSION_LENGTH;
  return [
    t / SESSION_LENGTH,
    rest ? 1 : 0,
    exercise ? 1 : 0,
    !rest && !exercise ? 1 : 0,
    (t - start) / (end - start),
  ];
}

export function encodeTarget(hr: number, skinTemp: number): number[] {
  return [
    (hr - RESTING_HR) / (EXERCISE_HR - RESTING_HR),
    (skinTemp - SKIN_TEMP_REFERENCE) / SKIN_TEMP_RANGE,
  ];
}

export function predict(layers: Layer[], t: number): Prediction {
  const [hr, skinTemp] = forward(layers, contextFeatures(t));
  return {
    hr: RESTING_HR + hr * (EXERCISE_HR - RESTING_HR),
    skinTemp: SKIN_TEMP_REFERENCE + skinTemp * SKIN_TEMP_RANGE,
  };
}

export function countParameters(layers: Layer[]): number {
  return layers.reduce(
    (total, layer) => total + layer.biases.length + layer.weights.length * layer.weights[0].length,
    0,
  );
}
