import storedModel from '../ml/model.json';
import type { Model } from '../ml/network';
import { WINDOW_SIZE } from '../sim/anomaly';
import { SESSION_LENGTH } from '../sim/baseline';
import { CAUSE_ACTION, CAUSE_DETAIL, CAUSE_LABEL } from '../sim/cause';
import type { Cause } from '../sim/cause';
import { alertAt, runScenario } from '../sim/crew';
import type { CrewRun } from '../sim/crew';
import { explain } from '../sim/explain';
import { formatClock } from '../sim/format';
import { correlate } from '../sim/incidents';
import type { Alert, Incident } from '../sim/incidents';
import { createGroundLedger, createLedger } from '../sim/ledger';
import type { GroundLedger, Ledger } from '../sim/ledger';
import { createLink } from '../sim/link';
import type { Link, Priority, Transfer, TransferStage } from '../sim/link';
import type { MonitorState } from '../sim/monitor';
import { SCENARIOS, scenarioById } from '../sim/scenarios';
import type { CrewId, Scenario } from '../sim/scenarios';
import { linkBytesPerSecond } from '../sim/sources/dsn';
import { blackoutOn, coverage, missionDay } from '../sim/sources/horizons';
import type { Blackout, MissionDay } from '../sim/sources/horizons';
import {
  ALERT_BYTES,
  BUNDLE_OVERHEAD_BYTES,
  HEARTBEAT_BYTES,
  RAW_WINDOW_BYTES,
  createTwin,
  encodeWindow,
  recordBytes,
} from '../sim/twin';
import type { Twin, TwinEstimate, TwinRecord } from '../sim/twin';
import type { Explanation, QualityReason, Sample, WindowResult } from '../sim/types';

export interface LogEntry {
  /** Simulation second at which the entry was written. */
  t: number;
  source: 'system' | 'sensor' | 'model' | 'link' | 'ground';
  level: 'info' | 'warn' | 'alert';
  message: string;
}

export interface CrewCard {
  id: CrewId;
  role: string;
  state: MonitorState | 'idle';
  /** Size of the deviation per window so far; null where the window was unreliable. */
  heat: Array<number | null>;
  cause: Cause | null;
  trending: boolean;
}

export interface LinkView {
  /** The operator's switch. */
  switchOn: boolean;
  available: boolean;
  reason: 'up' | 'switched-off' | 'blackout';
  /** One-way light time, in seconds. */
  delay: number;
  loss: number;
  bytesPerSecond: number;
  disturbed: boolean;
  lossInjected: boolean;
  degraded: boolean;
}

export interface GroundIncident {
  incident: Incident;
  /** Least advanced delivery stage among the incident's alerts. */
  stage: TransferStage;
  /** When the first of its alerts reached the ground; null until then. */
  receivedAt: number | null;
  raw: 'none' | 'requested' | 'in-transit' | 'received';
}

export interface DemoView {
  scenario: Scenario;
  /** Session seconds shown so far, capped at the session length. */
  elapsed: number;
  /** Seconds since the session started, including time after it ended. */
  clock: number;
  playing: boolean;
  finished: boolean;
  /** Finished, and everything on board has reached the ground. */
  settled: boolean;
  mission: { date: string; day: MissionDay | null; blackout: Blackout | null };
  link: LinkView;
  crew: CrewCard[];
  selected: CrewId;
  samples: Sample[];
  latest: Sample | null;
  /** Latest window of the selected astronaut, as read by the on-board model. */
  result: WindowResult | null;
  /** The same window as read by the statistical baseline, for comparison. */
  baseline: WindowResult | null;
  explanation: Explanation | null;
  cause: Cause | null;
  /** Every window the model has read so far for the selected astronaut. */
  results: WindowResult[];
  transfers: Transfer[];
  incidents: GroundIncident[];
  /** The selected astronaut as the ground sees them, one estimate per window. */
  twin: TwinEstimate[];
  bytes: { sent: number; raw: number; packetsLost: number; repairs: number };
  ledger: { head: number; verified: number; acknowledged: number; missing: Array<[number, number]>; duplicates: number };
  quality: { reliable: number; total: number; target: number };
  log: LogEntry[];
}

export interface Demo {
  view(): DemoView;
  step(): void;
  /** Runs the clock forward without stopping at each second; used once the session is over. */
  advance(seconds: number): void;
  /** Jumps to the first day after the current solar blackout. */
  advanceToContact(): void;
  play(): void;
  pause(): void;
  reset(): void;
  select(scenario: string): void;
  selectCrew(id: CrewId): void;
  setConnected(connected: boolean): void;
  setMissionDate(date: string): void;
  setLossInjected(on: boolean): void;
  setDegraded(on: boolean): void;
  /** The ground asks for the raw windows behind an incident. */
  requestRaw(incidentId: string): void;
}

const model = storedModel as Model;

/** Share of windows that should be reliable over a session. */
export const QUALITY_TARGET = 0.9;
export const INJECTED_LOSS = 0.3;
export const DEGRADED_FACTOR = 0.01;
const TELEMETRY_SECONDS = 60;
const RAW_WINDOWS = 3;
const DAY_SECONDS = 86_400;

const SKIP_TEXT: Record<QualityReason, string> = {
  ok: 'ok',
  'no-contact': 'no skin contact',
  'missing-data': 'missing readings',
  motion: 'movement interference',
};

const STAGE_ORDER: TransferStage[] = ['saved', 'waiting', 'repair', 'sending', 'in-flight', 'received'];

interface Outgoing {
  priority: Priority;
  bytes: number;
  label: string;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_SECONDS * 1000).toISOString().slice(0, 10);

/** The cause named when the alert was raised holds while the alert lasts; otherwise the latest window's. */
function causeAt(run: CrewRun, windows: number): Cause {
  if (run.monitor[windows - 1].state === 'alert') {
    for (let i = windows - 1; i >= 0; i--) if (run.monitor[i].raised) return run.causes[i];
  }
  return run.causes[windows - 1];
}

export function createDemo(initial = SCENARIOS[0].id): Demo {
  let scenario = scenarioById(initial);
  let runs: CrewRun[] = [];
  let selected: CrewId = scenario.focus;
  let clock = 0;
  let playing = false;
  let switchOn = true;
  let lossInjected = false;
  let degraded = false;
  let missionDate = scenario.link.missionDate;
  let log: LogEntry[] = [];

  let ledger: Ledger = createLedger();
  let ground: GroundLedger = createGroundLedger();
  let link: Link = createLink();
  /** What each ledger record costs to send; stored with the ledger, so it survives a restart. */
  let outgoing = new Map<number, Outgoing>();
  /** Messages that had left the antenna when the server restarted. */
  let departed: Transfer[] = [];
  let delivered = new Set<string>();
  let stages = new Map<string, TransferStage>();
  let twins = new Map<CrewId, Twin>();
  let alerts: Alert[] = [];
  let groundAlerts = new Map<string, number>();
  let rawState = new Map<string, GroundIncident['raw']>();
  let requests: Array<{ at: number; incidentId: string }> = [];
  let acks: Array<{ at: number; seq: number }> = [];
  let acknowledged = 0;
  let pending: Partial<Record<CrewId, TwinRecord[]>> = {};
  let rawBytes = 0;
  let sentBefore = 0;
  let lostBefore = 0;
  let repairsBefore = 0;
  let wasAvailable = true;
  let wasDisturbed = false;
  let restarts = 0;

  const write = (source: LogEntry['source'], level: LogEntry['level'], message: string) => {
    log.push({ t: clock, source, level, message });
  };

  const today = () => addDays(missionDate, Math.floor(clock / DAY_SECONDS));

  function conditions(): LinkView {
    const day = missionDay(today());
    const disturbance = scenario.link.disturbance;
    const disturbed = disturbance !== undefined && clock >= disturbance.from && clock < disturbance.to;
    const blackout = day?.blackout ?? false;
    const factor = (disturbed ? disturbance.rateFactor : 1) * (degraded ? DEGRADED_FACTOR : 1);
    return {
      switchOn,
      available: switchOn && !blackout,
      reason: !switchOn ? 'switched-off' : blackout ? 'blackout' : 'up',
      delay: Math.round(day?.lightSeconds ?? 0),
      loss: Math.max(disturbed ? disturbance.loss : 0, lossInjected ? INJECTED_LOSS : 0),
      bytesPerSecond: linkBytesPerSecond() * factor,
      disturbed,
      lossInjected,
      degraded,
    };
  }

  function load(next: Scenario) {
    scenario = next;
    runs = runScenario(next, model);
    selected = next.focus;
    clock = 0;
    playing = false;
    switchOn = next.link.startConnected;
    lossInjected = false;
    degraded = false;
    missionDate = next.link.missionDate;
    log = [];
    ledger = createLedger();
    ground = createGroundLedger();
    link = createLink();
    outgoing = new Map();
    departed = [];
    delivered = new Set();
    stages = new Map();
    twins = new Map(runs.map((run) => [run.member.id, createTwin(model)]));
    alerts = [];
    groundAlerts = new Map();
    rawState = new Map();
    requests = [];
    acks = [];
    acknowledged = 0;
    pending = {};
    rawBytes = 0;
    sentBefore = 0;
    lostBefore = 0;
    repairsBefore = 0;
    wasAvailable = conditions().available;
    wasDisturbed = false;
    restarts = 0;
  }

  /** Writes a record to the ledger and queues the message that carries it. */
  function record(kind: string, body: unknown, message: Outgoing, id: string) {
    const entry = ledger.append(clock, kind, JSON.stringify(body));
    outgoing.set(entry.seq, message);
    link.enqueue({ id, createdAt: clock, seqs: [entry.seq], ...message });
    return entry;
  }

  const transfers = () => [...departed, ...link.items()];

  /** Applies a record the ground has just accepted. */
  function applyOnGround(kind: string, body: string, receivedAt: number) {
    if (kind === 'alert') {
      const alert = JSON.parse(body) as Alert;
      groundAlerts.set(alert.id, receivedAt);
    } else if (kind === 'telemetry') {
      const packet = JSON.parse(body) as { through: number; records: Partial<Record<CrewId, TwinRecord[]>> };
      for (const [id, twin] of twins) {
        for (const item of packet.records[id] ?? []) twin.apply(item);
        twin.confirm(packet.through);
      }
    } else if (kind === 'raw') {
      rawState.set((JSON.parse(body) as { incidentId: string }).incidentId, 'received');
    }
  }

  /** Moves the link one second and handles whatever reached the ground or came back. */
  function tick() {
    const now = conditions();

    if (now.available !== wasAvailable) {
      write(
        'link',
        now.available ? 'info' : 'warn',
        now.available ? 'link to Earth up' : now.reason === 'blackout' ? 'link to Earth down: solar conjunction' : 'link to Earth down',
      );
      wasAvailable = now.available;
    }
    if (now.disturbed !== wasDisturbed) {
      write('link', now.disturbed ? 'warn' : 'info', now.disturbed ? `link degraded: ${Math.round(now.loss * 100)}% packet loss` : 'link back to nominal');
      wasDisturbed = now.disturbed;
    }

    for (const request of requests.filter((item) => item.at <= clock)) {
      record('raw', { incidentId: request.incidentId, windows: RAW_WINDOWS }, { priority: 2, bytes: BUNDLE_OVERHEAD_BYTES + RAW_WINDOWS * RAW_WINDOW_BYTES, label: 'Raw windows' }, `raw-${request.incidentId}`);
      rawState.set(request.incidentId, 'in-transit');
      write('link', 'info', 'raw windows queued at the ground team\'s request');
    }
    requests = requests.filter((item) => item.at > clock);

    for (const item of departed) {
      if (item.stage === 'in-flight' && item.arrivesAt !== null && clock >= item.arrivesAt) {
        item.stage = 'received';
        item.receivedAt = item.arrivesAt;
      }
    }
    link.tick(clock, now);

    for (const item of transfers()) {
      const key = `${item.message.id}/${item.attempts}`;
      if (stages.get(item.message.id) !== item.stage) {
        stages.set(item.message.id, item.stage);
        if (item.stage === 'waiting') write('link', 'warn', `${item.message.label} waiting: no link`);
        if (item.stage === 'in-flight') write('link', 'info', `${item.message.label} sent, arrives in ${formatClock(now.delay)}`);
        if (item.stage === 'repair') write('link', 'warn', `${item.message.label} lost too many packets; resend scheduled`);
      }
      if (item.stage !== 'received' || delivered.has(key)) continue;
      delivered.add(key);
      for (const seq of item.message.seqs) {
        const [entry] = ledger.range(seq, seq);
        const receipt = ground.receive(entry);
        if (receipt === 'accepted') applyOnGround(entry.kind, entry.body, item.receivedAt ?? clock);
        write('ground', 'info', receipt === 'duplicate' ? `${item.message.label} received again: duplicate dropped` : `${item.message.label} received on ground`);
      }
      acks.push({ at: (item.receivedAt ?? clock) + now.delay, seq: ground.verified() });
    }

    for (const ack of acks.filter((item) => item.at <= clock)) acknowledged = Math.max(acknowledged, ack.seq);
    acks = acks.filter((item) => item.at > clock);
  }

  function closeWindow(index: number) {
    for (const run of runs) {
      const id = run.member.id;
      const result = run.results[index];
      const before = index > 0 ? run.monitor[index - 1].state : 'ok';
      const state = run.monitor[index].state;
      const span = `${formatClock(result.tStart)}-${formatClock(result.tEnd + 1)}`;

      const item = encodeWindow(index, run.scores[index]);
      if (item) (pending[id] ??= []).push(item);

      if (result.score === null) write('model', 'warn', `${id} window ${span} discarded: ${SKIP_TEXT[result.quality.reason]}`);
      else if (result.deviating) write('model', 'warn', `${id} window ${span} deviates: ${Math.abs(result.score).toFixed(1)} spreads`);
      if (state !== before && state !== 'no-data' && before !== 'no-data') write('model', state === 'alert' ? 'alert' : 'info', `${id} monitor ${before} to ${state}`);

      const alert = alertAt(run, index);
      if (alert) {
        alerts.push(alert);
        write('model', 'alert', `${id} change to verify, likely cause: ${CAUSE_LABEL[alert.cause].toLowerCase()}`);
        record('alert', alert, { priority: 0, bytes: BUNDLE_OVERHEAD_BYTES + ALERT_BYTES, label: `Alert ${id}` }, alert.id);
      }
    }
  }

  /** One bundle a minute: what the ground could not have predicted, and a heartbeat for the rest. */
  function sendTelemetry() {
    const through = clock / WINDOW_SIZE - 1;
    const records = pending;
    pending = {};
    const count = Object.values(records).reduce((sum, list) => sum + (list?.length ?? 0), 0);
    const bytes =
      BUNDLE_OVERHEAD_BYTES +
      HEARTBEAT_BYTES +
      Object.values(records).reduce((sum, list) => sum + (list ?? []).reduce((inner, item) => inner + recordBytes(item), 0), 0);
    record('telemetry', { through, records }, { priority: 1, bytes, label: `Update ${formatClock(clock)}` }, `tm-${clock}`);
    rawBytes += BUNDLE_OVERHEAD_BYTES + runs.length * (TELEMETRY_SECONDS / WINDOW_SIZE) * RAW_WINDOW_BYTES;
    write('link', 'info', `update queued: ${count} of ${runs.length * (TELEMETRY_SECONDS / WINDOW_SIZE)} windows needed sending, ${bytes} bytes`);
  }

  /** The volatile queue is lost; the ledger is not. Resend whatever was never acknowledged. */
  function restart() {
    restarts += 1;
    sentBefore += link.stats().bytesSent;
    lostBefore += link.stats().packetsLost;
    repairsBefore += link.stats().repairs;
    departed.push(...link.items().filter((item) => item.stage === 'in-flight' || item.stage === 'received'));
    link = createLink(restarts + 1);
    const unconfirmed = ledger.range(acknowledged + 1, ledger.head());
    for (const entry of unconfirmed) {
      const message = outgoing.get(entry.seq)!;
      link.enqueue({ id: `resend-${restarts}-${entry.seq}`, createdAt: entry.t, seqs: [entry.seq], ...message, label: `${message.label} (resend)` });
    }
    write('system', 'warn', `server restarted: ${unconfirmed.length} unacknowledged records re-queued from the ledger`);
  }

  function second() {
    clock += 1;
    if (clock <= SESSION_LENGTH) {
      if (clock === 1) {
        write('system', 'info', `session started: ${scenario.label.toLowerCase()}`);
        if (!wasAvailable) write('link', 'warn', conditions().reason === 'blackout' ? 'link to Earth down: solar conjunction' : 'link to Earth down');
      }
      for (const run of runs) {
        const sample = run.samples[clock - 1];
        const before = clock > 1 ? run.samples[clock - 2] : null;
        if (run.member.id === selected && before && before.phase !== sample.phase) write('system', 'info', `phase: ${sample.phase}`);
        if (before && before.contact !== sample.contact) {
          write('sensor', sample.contact ? 'info' : 'warn', `${run.member.id} ${sample.contact ? 'skin contact restored' : 'skin contact lost'}`);
        }
      }
      if (clock % WINDOW_SIZE === 0) closeWindow(clock / WINDOW_SIZE - 1);
      if (clock % TELEMETRY_SECONDS === 0) sendTelemetry();
      if (clock === scenario.restartAt) restart();
      if (clock === SESSION_LENGTH) write('system', 'info', 'session complete');
    }
    tick();
  }

  load(scenario);

  return {
    step: second,

    advance(seconds) {
      for (let i = 0; i < seconds; i++) second();
    },

    advanceToContact() {
      const blackout = blackoutOn(today());
      if (!blackout) return;
      const days = Math.round((Date.parse(blackout.end) - Date.parse(today())) / (DAY_SECONDS * 1000));
      clock += days * DAY_SECONDS;
      write('system', 'info', `advanced ${days} days to the end of the solar conjunction`);
      tick();
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
      load(scenarioById(next));
    },

    selectCrew(id) {
      selected = id;
    },

    setConnected(value) {
      switchOn = value;
      tick();
    },

    setMissionDate(date) {
      const range = coverage();
      if (date < range.start || date > range.end) return;
      missionDate = addDays(date, -Math.floor(clock / DAY_SECONDS));
      write('system', 'info', `mission date set to ${date}`);
      tick();
    },

    setLossInjected(on) {
      lossInjected = on;
      write('link', on ? 'warn' : 'info', on ? `packet loss injected: ${INJECTED_LOSS * 100}%` : 'injected packet loss removed');
    },

    setDegraded(on) {
      degraded = on;
      write('link', on ? 'warn' : 'info', on ? 'link rate cut to 1% of nominal' : 'link rate back to nominal');
    },

    requestRaw(incidentId) {
      if (rawState.has(incidentId)) return;
      rawState.set(incidentId, 'requested');
      // The request has to cross the same distance before the server sees it.
      requests.push({ at: clock + conditions().delay, incidentId });
      write('ground', 'info', 'ground team requested the raw windows');
    },

    view() {
      const elapsed = Math.min(clock, SESSION_LENGTH);
      const windows = Math.floor(elapsed / WINDOW_SIZE);
      const run = runs.find((candidate) => candidate.member.id === selected)!;
      const result = windows > 0 ? run.results[windows - 1] : null;
      const cause = result && (result.state !== 'within-pattern' || result.deviating) ? causeAt(run, windows) : null;
      const all = transfers();
      const finished = clock >= SESSION_LENGTH;
      const now = conditions();
      const date = today();

      let explanation = result ? explain(result) : null;
      if (explanation && result?.state === 'change-to-verify' && cause) {
        explanation = { ...explanation, detail: `${explanation.detail} ${CAUSE_DETAIL[cause]}`, action: CAUSE_ACTION[cause] };
      }

      const stageOf = (alert: Alert): TransferStage => {
        if (groundAlerts.has(alert.id)) return 'received';
        const [entry] = ledger.entries().filter((item) => item.kind === 'alert' && item.body.includes(`"${alert.id}"`));
        const carrying = all.filter((item) => entry && item.message.seqs.includes(entry.seq));
        return carrying.reduce<TransferStage>(
          (best, item) => (STAGE_ORDER.indexOf(item.stage) > STAGE_ORDER.indexOf(best) ? item.stage : best),
          'saved',
        );
      };

      const reliable = runs.reduce((sum, item) => sum + item.results.slice(0, windows).filter((r) => r.quality.reliable).length, 0);

      return {
        scenario,
        elapsed,
        clock,
        playing,
        finished,
        settled: finished && requests.length === 0 && all.every((item) => item.stage === 'received'),
        mission: { date, day: missionDay(date), blackout: blackoutOn(date) },
        link: now,
        crew: runs.map((item) => ({
          id: item.member.id,
          role: item.member.role,
          state: windows > 0 ? item.monitor[windows - 1].state : 'idle',
          heat: item.results.slice(0, windows).map((r) => (r.score === null ? null : Math.abs(r.score))),
          cause: windows > 0 && item.monitor[windows - 1].state !== 'ok' ? causeAt(item, windows) : null,
          trending: windows > 0 && item.monitor[windows - 1].trending,
        })),
        selected,
        samples: run.samples.slice(0, elapsed),
        latest: elapsed > 0 ? run.samples[elapsed - 1] : null,
        result,
        baseline: windows > 0 ? run.baseline[windows - 1] : null,
        explanation,
        cause,
        results: run.results.slice(0, windows),
        transfers: all,
        incidents: correlate(alerts).map((incident) => {
          const order = incident.alerts.map((alert) => STAGE_ORDER.indexOf(stageOf(alert)));
          const received = incident.alerts.flatMap((alert) => groundAlerts.get(alert.id) ?? []);
          return {
            incident,
            stage: STAGE_ORDER[Math.min(...order)],
            receivedAt: received.length > 0 ? Math.min(...received) : null,
            raw: rawState.get(incident.id) ?? 'none',
          };
        }),
        twin: Array.from({ length: windows }, (_, w) => twins.get(selected)!.estimate(w)),
        bytes: { sent: sentBefore + link.stats().bytesSent, raw: rawBytes, packetsLost: lostBefore + link.stats().packetsLost, repairs: repairsBefore + link.stats().repairs },
        ledger: {
          head: ledger.head(),
          verified: ground.verified(),
          acknowledged,
          missing: ground.missing(),
          duplicates: ground.duplicates(),
        },
        quality: { reliable, total: windows * runs.length, target: QUALITY_TARGET },
        log: [...log],
      };
    },
  };
}
