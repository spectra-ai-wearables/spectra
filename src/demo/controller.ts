import { WINDOW_SIZE, analyzeSession } from '../sim/anomaly';
import { SESSION_LENGTH } from '../sim/baseline';
import { explain, toEvent } from '../sim/explain';
import { analyzeWithModel } from '../ml/detector';
import storedModel from '../ml/model.json';
import type { Model } from '../ml/network';
import { formatClock } from '../sim/format';
import { generateSession } from '../sim/generator';
import { createLinkQueue } from '../sim/link';
import type { LinkQueue } from '../sim/link';
import type {
  EventStage,
  Explanation,
  QualityReason,
  QueuedEvent,
  Sample,
  ScenarioId,
  WindowResult,
} from '../sim/types';

export interface LogEntry {
  /** Simulation second at which the entry was written. */
  t: number;
  source: 'system' | 'sensor' | 'model' | 'link';
  level: 'info' | 'warn' | 'alert';
  message: string;
}

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
  /** Latest window as read by the on-board model; drives the state shown. */
  result: WindowResult | null;
  /** The same window as read by the statistical baseline, for comparison. */
  baseline: WindowResult | null;
  explanation: Explanation | null;
  events: QueuedEvent[];
  /** Every window the model has read so far. */
  results: WindowResult[];
  log: LogEntry[];
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

const model = storedModel as Model;

const SCENARIO_NAME: Record<ScenarioId, string> = {
  usual: 'usual recovery',
  misplaced: 'sensor misplaced',
  atypical: 'atypical recovery',
};

const SKIP_TEXT: Record<QualityReason, string> = {
  ok: 'ok',
  'no-contact': 'no skin contact',
  'missing-data': 'missing readings',
  motion: 'movement interference',
};

const STAGE_TEXT: Record<EventStage, string> = {
  saved: 'saved on board',
  waiting: 'waiting: no link',
  sending: 'sending to ground',
  received: 'received on ground',
};

const scoreText = (result: WindowResult) =>
  result.score === null ? 'n/a' : Math.abs(result.score).toFixed(1);

export function createDemo(initial: ScenarioId = 'usual'): Demo {
  let scenario = initial;
  let samples: Sample[] = [];
  let results: WindowResult[] = [];
  let baselineResults: WindowResult[] = [];
  let link: LinkQueue = createLinkQueue();
  let clock = 0;
  let playing = false;
  let connected = true;
  let log: LogEntry[] = [];
  let stages = new Map<string, EventStage>();

  function load(next: ScenarioId) {
    scenario = next;
    samples = generateSession(next);
    results = analyzeWithModel(samples, model);
    baselineResults = analyzeSession(samples);
    link = createLinkQueue();
    clock = 0;
    playing = false;
    connected = next !== 'atypical';
    log = [];
    stages = new Map();
  }

  const write = (source: LogEntry['source'], level: LogEntry['level'], message: string) => {
    log.push({ t: clock, source, level, message });
  };

  /** Advances the queue and logs every event that changed stage. */
  function syncLink() {
    link.tick(clock, connected);
    for (const item of link.items()) {
      if (stages.get(item.event.id) === item.stage) continue;
      stages.set(item.event.id, item.stage);
      write('link', item.stage === 'waiting' ? 'warn' : 'info', `${item.event.id} ${STAGE_TEXT[item.stage]}`);
    }
  }

  function closeWindow(index: number) {
    const result = results[index];
    const previous = index > 0 ? results[index - 1] : null;
    const span = `${formatClock(result.tStart)}-${formatClock(result.tEnd + 1)}`;

    if (result.score === null) {
      write('model', 'warn', `window ${span} not scored: ${SKIP_TEXT[result.quality.reason]}`);
    } else {
      write(
        'model',
        result.deviating ? 'warn' : 'info',
        `window ${span} model ${scoreText(result)} baseline ${scoreText(baselineResults[index])}`,
      );
    }

    if (result.state === 'change-to-verify' && previous?.state !== 'change-to-verify') {
      const event = toEvent(result, explain(result));
      write('model', 'alert', `change to verify: ${event.detail}`);
      link.enqueue(event);
      stages.set(event.id, 'saved');
      write('link', 'info', `${event.id} ${STAGE_TEXT.saved}`);
    }
  }

  load(initial);

  return {
    step() {
      clock += 1;
      if (clock <= SESSION_LENGTH) {
        const sample = samples[clock - 1];
        const before = clock > 1 ? samples[clock - 2] : null;
        if (clock === 1) {
          write('system', 'info', `session started: ${SCENARIO_NAME[scenario]}`);
          if (!connected) write('link', 'warn', 'link to Earth down');
        }
        if (before && before.phase !== sample.phase) write('system', 'info', `phase: ${sample.phase}`);
        if (before && before.contact !== sample.contact) {
          write('sensor', sample.contact ? 'info' : 'warn', sample.contact ? 'skin contact restored' : 'skin contact lost');
        }
        if (clock % WINDOW_SIZE === 0) closeWindow(clock / WINDOW_SIZE - 1);
        if (clock === SESSION_LENGTH) write('system', 'info', 'session complete');
      }
      syncLink();
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
      if (value !== connected) write('link', value ? 'info' : 'warn', value ? 'link to Earth up' : 'link to Earth down');
      connected = value;
      syncLink();
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
        baseline: windows > 0 ? baselineResults[windows - 1] : null,
        explanation: result ? explain(result) : null,
        events,
        results: results.slice(0, windows),
        log: [...log],
      };
    },
  };
}