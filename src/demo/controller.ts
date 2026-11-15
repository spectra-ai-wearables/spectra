import { WINDOW_SIZE, analyzeSession } from '../sim/anomaly';
import { SESSION_LENGTH } from '../sim/baseline';
import { explain, toEvent } from '../sim/explain';
import { generateSession } from '../sim/generator';
import { createLinkQueue } from '../sim/link';
import type { LinkQueue } from '../sim/link';
import type {
  Explanation,
  QueuedEvent,
  Sample,
  ScenarioId,
  WindowResult,
} from '../sim/types';

export interface DemoView {
  scenario: ScenarioId;
  /** Simulation seconds shown so far, capped at the session length. */
  elapsed: number;
  playing: boolean;
  /** The session reached its end. */
  finished: boolean;
  /** Finished and every event reached the ground. */
  settled: boolean;
  connected: boolean;
  samples: Sample[];
  latest: Sample | null;
  result: WindowResult | null;
  explanation: Explanation | null;
  events: QueuedEvent[];
}

export interface Demo {
  view(): DemoView;
  step(): void;
  play(): void;
  pause(): void;
  reset(): void;
  select(scenario: ScenarioId): void;
  setConnected(connected: boolean): void;
}

export function createDemo(initial: ScenarioId = 'usual'): Demo {
  let scenario = initial;
  let samples: Sample[] = [];
  let results: WindowResult[] = [];
  let link: LinkQueue = createLinkQueue();
  let clock = 0;
  let playing = false;
  let connected = true;

  function load(next: ScenarioId) {
    scenario = next;
    samples = generateSession(next);
    results = analyzeSession(samples);
    link = createLinkQueue();
    clock = 0;
    playing = false;
    connected = next !== 'atypical';
  }

  load(initial);

  return {
    step() {
      clock += 1;
      if (clock <= SESSION_LENGTH && clock % WINDOW_SIZE === 0) {
        const index = clock / WINDOW_SIZE - 1;
        const result = results[index];
        const previous = index > 0 ? results[index - 1] : null;
        if (result.state === 'change-to-verify' && previous?.state !== 'change-to-verify') {
          link.enqueue(toEvent(result, explain(result)));
        }
      }
      link.tick(clock, connected);
    },

    play() {
      playing = true;
    },

    pause() {
      playing = false;
    },

    reset() {
      load(scenario);
    },

    select(next) {
      load(next);
    },

    setConnected(value) {
      connected = value;
      link.tick(clock, connected);
    },

    view() {
      const elapsed = Math.min(clock, SESSION_LENGTH);
      const windows = Math.floor(elapsed / WINDOW_SIZE);
      const result = windows > 0 ? results[windows - 1] : null;
      const events = link.items();
      const finished = clock >= SESSION_LENGTH;
      return {
        scenario,
        elapsed,
        playing,
        finished,
        settled: finished && events.every((item) => item.stage === 'received'),
        connected,
        samples: samples.slice(0, elapsed),
        latest: elapsed > 0 ? samples[elapsed - 1] : null,
        result,
        explanation: result ? explain(result) : null,
        events,
      };
    },
  };
}
