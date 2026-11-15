import { mulberry32 } from '../sim/random';
import type { Layer } from './network';

export interface TrainOptions {
  /** Units in each hidden layer. */
  hidden: number[];
  epochs: number;
  batchSize: number;
  learningRate: number;
  /** Learning rate is multiplied by this after every epoch. */
  decay: number;
  seed: number;
}

export interface TrainResult {
  layers: Layer[];
  /** Mean squared error over the last epoch. */
  loss: number;
}

const BETA1 = 0.9;
const BETA2 = 0.999;
const EPSILON = 1e-8;

const zerosLike = (layers: Layer[]): Layer[] =>
  layers.map((layer) => ({
    weights: layer.weights.map((row) => row.map(() => 0)),
    biases: layer.biases.map(() => 0),
  }));

/** Trains a tanh network on a regression task with mini-batch Adam and backpropagation. */
export function train(inputs: number[][], targets: number[][], options: TrainOptions): TrainResult {
  const random = mulberry32(options.seed);
  const sizes = [inputs[0].length, ...options.hidden, targets[0].length];

  const layers: Layer[] = sizes.slice(1).map((outputs, l) => {
    const limit = Math.sqrt(6 / (sizes[l] + outputs));
    return {
      weights: Array.from({ length: outputs }, () =>
        Array.from({ length: sizes[l] }, () => (random() * 2 - 1) * limit),
      ),
      biases: new Array<number>(outputs).fill(0),
    };
  });

  const m = zerosLike(layers);
  const v = zerosLike(layers);
  const order = inputs.map((_, i) => i);
  let step = 0;
  let loss = 0;

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const rate = options.learningRate * options.decay ** epoch;
    let squaredError = 0;

    for (let start = 0; start < order.length; start += options.batchSize) {
      const batch = order.slice(start, start + options.batchSize);
      const gradient = zerosLike(layers);

      for (const index of batch) {
        // Forward pass, keeping every layer's activation.
        const activations: number[][] = [inputs[index]];
        layers.forEach((layer, l) => {
          const previous = activations[l];
          const isOutput = l === layers.length - 1;
          activations.push(
            layer.weights.map((row, j) => {
              let sum = layer.biases[j];
              for (let k = 0; k < row.length; k++) sum += row[k] * previous[k];
              return isOutput ? sum : Math.tanh(sum);
            }),
          );
        });

        // Backward pass.
        const output = activations[layers.length];
        let delta = output.map((value, j) => value - targets[index][j]);
        for (const d of delta) squaredError += d * d;

        for (let l = layers.length - 1; l >= 0; l--) {
          const previous = activations[l];
          for (let j = 0; j < delta.length; j++) {
            gradient[l].biases[j] += delta[j];
            const row = gradient[l].weights[j];
            for (let k = 0; k < previous.length; k++) row[k] += delta[j] * previous[k];
          }
          if (l > 0) {
            const weights = layers[l].weights;
            const current = delta;
            delta = previous.map((a, k) => {
              let sum = 0;
              for (let j = 0; j < current.length; j++) sum += weights[j][k] * current[j];
              return sum * (1 - a * a);
            });
          }
        }
      }

      step += 1;
      const correction1 = 1 - BETA1 ** step;
      const correction2 = 1 - BETA2 ** step;
      const adam = (g: number, mArr: number[], vArr: number[], k: number) => {
        mArr[k] = BETA1 * mArr[k] + (1 - BETA1) * g;
        vArr[k] = BETA2 * vArr[k] + (1 - BETA2) * g * g;
        return (rate * (mArr[k] / correction1)) / (Math.sqrt(vArr[k] / correction2) + EPSILON);
      };

      layers.forEach((layer, l) => {
        for (let j = 0; j < layer.biases.length; j++) {
          layer.biases[j] -= adam(gradient[l].biases[j] / batch.length, m[l].biases, v[l].biases, j);
          const row = layer.weights[j];
          for (let k = 0; k < row.length; k++) {
            row[k] -= adam(gradient[l].weights[j][k] / batch.length, m[l].weights[j], v[l].weights[j], k);
          }
        }
      });
    }

    loss = squaredError / (order.length * targets[0].length);
  }

  return { layers, loss };
}
