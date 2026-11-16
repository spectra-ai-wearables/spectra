/**
 * The techniques the site names, each with a plain sentence, the technical
 * detail and the real parameters. "implemented" means the code in this
 * repository does it; "modelled" means the simulator imitates its effect;
 * "proposed" means it is part of the design and not built.
 */
import model from './ml/model.json';
import { WINDOW_SIZE, PERSISTENCE, DEVIATION_THRESHOLD } from './sim/anomaly';
import { BASELINE_SIGMA } from './sim/baseline';
import { CREW_SHARE, QUIET_RATIO, STRONG_Z } from './sim/cause';
import { PACKET_BYTES, REPAIR_MARGIN } from './sim/link';
import { CLEAR_WINDOWS, CUSUM_SLACK, CUSUM_WARN } from './sim/monitor';
import { MAX_MOTION, MIN_CONTACT, MIN_VALID } from './sim/quality';
import { BUNDLE_OVERHEAD_BYTES, DEAD_BAND, HR_STEP, RAW_WINDOW_BYTES, RESIDUAL_BYTES, TEMP_STEP } from './sim/twin';

export type TermStatus = 'implemented' | 'modelled' | 'proposed';

export interface Term {
  id: string;
  name: string;
  status: TermStatus;
  plain: string;
  detail: string;
  formula?: string;
  file?: string;
}

export const STATUS_LABEL: Record<TermStatus, string> = {
  implemented: 'Implemented in the demo',
  modelled: 'Modelled in the demo',
  proposed: 'Proposed for flight hardware',
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

export const TERMS: Term[] = [
  {
    id: 'signal-quality',
    name: 'Signal quality check',
    status: 'implemented',
    plain: 'Before anything is scored, each window is checked for whether the sensor could be trusted.',
    detail: `A window is ${WINDOW_SIZE} one-second samples. It is discarded when skin contact covers less than ${percent(MIN_CONTACT)} of it, when fewer than ${percent(MIN_VALID)} of the samples carry a heart rate, or when mean motion intensity exceeds ${MAX_MOTION} on a 0 to 1 scale.`,
    file: 'src/sim/quality.ts',
  },
  {
    id: 'reference-model',
    name: 'Personal reference model',
    status: 'implemented',
    plain: 'A small neural network learns what this astronaut usually looks like at each moment of an activity.',
    detail: `A fully connected network with two hidden layers of 16 tanh units and ${model.training.parameters} parameters. Its five inputs describe the moment in the planned activity; its two outputs are the expected heart rate and skin temperature. It was trained with Adam for ${model.training.epochs} epochs on ${model.training.sessions} synthetic sessions.`,
    formula: 'inputs: [t/T, rest, exercise, recovery, progress in phase] → [heart rate, skin temperature]',
    file: 'src/ml/network.ts',
  },
  {
    id: 'deviation-score',
    name: 'Deviation score',
    status: 'implemented',
    plain: 'How far a window is from the reference, measured in units of this astronaut’s usual variation.',
    detail: `For each signal, the median difference from the prediction is divided by the spread learned for that window position on ${model.training.validationSessions} validation sessions. The two results are combined, and a window deviates at ${model.threshold} or more.`,
    formula: 'score = √((z_hr² + z_temp²) / 2),  z = median(measured − predicted) / spread',
    file: 'src/ml/detector.ts',
  },
  {
    id: 'statistical-baseline',
    name: 'Statistical baseline',
    status: 'implemented',
    plain: 'A hand-written reference that runs beside the model, to show whether the model adds anything.',
    detail: `It compares heart rate with a fixed curve for the activity and divides the window’s median difference by a fixed spread of ${BASELINE_SIGMA} bpm. The median keeps a single wild sample from moving the result. The threshold is the same ${DEVIATION_THRESHOLD}.`,
    formula: 'score = median(measured − expected) / σ',
    file: 'src/sim/anomaly.ts',
  },
  {
    id: 'persistence',
    name: 'Persistence and hysteresis',
    status: 'implemented',
    plain: 'One odd window is not an alert, and a monitor does not flicker on its way back to normal.',
    detail: `An alert needs ${PERSISTENCE} deviating windows in a row. Once raised, the monitor steps down only after ${CLEAR_WINDOWS} calm windows in a row. An unreliable window shows as "no data" and does not clear the state behind it.`,
    file: 'src/sim/monitor.ts',
  },
  {
    id: 'cusum',
    name: 'CUSUM trend',
    status: 'implemented',
    plain: 'Small deviations that keep pointing the same way are added up, so a slow drift holds a warning.',
    detail: `The signed score feeds an upward and a downward sum; each window may carry ${CUSUM_SLACK} spreads without adding to them. A sum of ${CUSUM_WARN} raises a warning, never an alert: 4 of 300 held-out normal sessions reach it.`,
    formula: `S⁺ ← max(0, S⁺ + z − ${CUSUM_SLACK}),  S⁻ ← max(0, S⁻ − z − ${CUSUM_SLACK})`,
    file: 'src/sim/monitor.ts',
  },
  {
    id: 'likely-cause',
    name: 'Likely cause',
    status: 'implemented',
    plain: 'Fixed rules say whether a change looks like movement, the sensor, the cabin or the body.',
    detail: `Unreliable windows are attributed to movement or to the sensor by their quality reason. When ${percent(CREW_SHARE)} of the crew deviates in the same direction, the cabin is named. When heart rate deviates by ${STRONG_Z} spreads or more and skin temperature moves less than ${percent(QUIET_RATIO)} as much, the sensor is named. Otherwise the change is called physiological. In the simulator skin temperature follows effort, which makes this easier than it would be on real data.`,
    file: 'src/sim/cause.ts',
  },
  {
    id: 'predictive-coding',
    name: 'Predictive coding',
    status: 'implemented',
    plain: 'The ground holds a copy of the reference model, so the server sends only what that copy could not predict.',
    detail: `A window whose two signals stay within ${DEAD_BAND} spreads is not sent; a heartbeat confirms it matched. Otherwise the residual goes out in ${RESIDUAL_BYTES} bytes, in steps of ${HR_STEP} bpm and ${TEMP_STEP} °C, against ${RAW_WINDOW_BYTES} bytes for the raw window. Past the last heartbeat the ground keeps projecting, and its band widens until news arrives.`,
    formula: 'sent = measured − predicted, only when |z| ≥ dead band',
    file: 'src/sim/twin.ts',
  },
  {
    id: 'ledger',
    name: 'Hash-chained ledger',
    status: 'implemented',
    plain: 'Every record carries the fingerprint of the one before it, so a gap or a change cannot go unnoticed.',
    detail: 'Records are appended with a sequence number and the SHA-256 hash of the previous record. The ground accepts them in any order and any number of times, reports only the sequence ranges it lacks, and drops duplicates. After a restart the server resends what was never acknowledged.',
    formula: 'hash_n = SHA-256(hash_{n−1} | n | time | kind | body)',
    file: 'src/sim/ledger.ts',
  },
  {
    id: 'erasure-coding',
    name: 'Erasure coding',
    status: 'modelled',
    plain: 'Extra repair packets go out with each message, so the ground can rebuild it without asking for a resend.',
    detail: `With minutes of delay each way, a resend request costs a round trip. The proposal is a fountain code such as RaptorQ (RFC 6330), where any sufficient subset of packets rebuilds the message. The simulator imitates the effect with ${PACKET_BYTES}-byte packets and does not encode them.`,
    formula: `packets sent = ⌈needed / (1 − expected loss) × ${REPAIR_MARGIN}⌉ + 1`,
    file: 'src/sim/link.ts',
  },
  {
    id: 'bundle-protocol',
    name: 'Bundle Protocol',
    status: 'proposed',
    plain: 'A store-and-forward network standard built for links that are slow, delayed and often down.',
    detail: `Bundle Protocol version 7 (RFC 9171) passes custody of data from node to node, each holding it until the next hop is reachable, with integrity and confidentiality from BPSec (RFC 9172). Delay-tolerant networking of this kind already runs on the International Space Station. The simulator only accounts for an assumed ${BUNDLE_OVERHEAD_BYTES} bytes of overhead per bundle.`,
  },
  {
    id: 'kalman-filter',
    name: 'Kalman filter',
    status: 'proposed',
    plain: 'A way to track a slowly changing personal baseline together with how uncertain it is.',
    detail: 'The state would be the astronaut’s offset from the reference; process noise sets how fast it may wander and measurement noise how much each window is trusted. Its covariance would replace the fixed rule that widens the ground’s band today.',
  },
  {
    id: 'conformal-prediction',
    name: 'Conformal prediction',
    status: 'proposed',
    plain: 'A way to set each astronaut’s threshold so that the false-alarm rate is known in advance.',
    detail: 'The threshold would be a quantile of the scores from that person’s own calibration sessions, which bounds the false-alarm rate without assuming a distribution. The demo uses one fixed threshold for everyone.',
  },
  {
    id: 'quantization',
    name: 'Integer quantization',
    status: 'proposed',
    plain: 'Storing the model’s weights as 8-bit integers so it runs on a small on-board computer.',
    detail: `The demo runs ${model.training.parameters} floating-point parameters in the browser, which is already tiny. A larger model on flight hardware would be quantized to int8 to cut memory and power.`,
  },
];

export function term(id: string): Term {
  const found = TERMS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown term ${id}`);
  return found;
}
