import { formatClock } from '../sim/format';
import type { Insight } from '../sim/insights';
import { MAX_MOTION } from '../sim/quality';
import type { EventStage, Phase, QualityReason, QueuedEvent, WindowResult } from '../sim/types';
import { bandPath, linePath, xAt, yAt } from './chart';
import type { DemoView, LogEntry } from './controller';

const PHASE_LABEL: Record<Phase, string> = {
  rest: 'Rest',
  exercise: 'Exercise',
  recovery: 'Recovery',
};

const QUALITY_LABEL: Record<QualityReason, string> = {
  ok: 'Good',
  'no-contact': 'No skin contact',
  'missing-data': 'Missing readings',
  motion: 'Movement interference',
};

const STAGE_LABEL: Record<EventStage, string> = {
  saved: 'Saved on board',
  waiting: 'Waiting to send',
  sending: 'Sending',
  received: 'Received on ground',
};

const IDLE = {
  label: 'Reading your signals',
  detail: 'Spectra needs ten seconds of readings before it compares them with your pattern.',
  action: 'Keep the band on.',
};

/** Score at which the meter is full; the threshold of 3 sits at a quarter. */
const METER_MAX = 12;

function one<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Demo markup is missing ${selector}`);
  return element;
}

function text(className: string, content: string, tag = 'p'): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

function setCell(element: HTMLElement, content: string, level: 'idle' | 'ok' | 'warn') {
  element.textContent = content;
  element.dataset.level = level;
}

function paintDetector(element: HTMLElement, result: WindowResult | null) {
  const score = result?.score ?? null;
  const verdict =
    result === null
      ? { key: 'none', text: '' }
      : result.state === 'insufficient-data'
        ? { key: 'none', text: 'not scored: unreliable data' }
        : result.state === 'change-to-verify'
          ? { key: 'verify', text: 'asks for a check' }
          : result.deviating
            ? { key: 'watch', text: 'above threshold, watching' }
            : { key: 'ok', text: 'within pattern' };

  element.dataset.verdict = verdict.key;
  one<HTMLElement>(element, '[data-score]').textContent =
    score === null ? (result === null ? 'Awaiting data' : 'Not scored') : Math.abs(score).toFixed(1);
  one<HTMLElement>(element, '[data-verdict-text]').textContent = verdict.text;
  element.style.setProperty(
    '--fill',
    String(score === null ? 0 : Math.min(Math.abs(score) / METER_MAX, 1)),
  );
}

function eventItem(item: QueuedEvent): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'event';
  li.dataset.stage = item.stage;
  li.append(
    text('event-stage', STAGE_LABEL[item.stage]),
    text('event-title', item.event.title),
    text('event-detail', item.event.detail),
    text(
      'event-time',
      item.receivedAt === null
        ? `Recorded on board at ${formatClock(item.event.createdAt)}`
        : `Recorded on board at ${formatClock(item.event.createdAt)} · received at ${formatClock(item.receivedAt)}`,
    ),
  );
  return li;
}

function logItem(entry: LogEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.level = entry.level;
  li.append(
    text('log-time', formatClock(entry.t), 'time'),
    text('log-source', entry.source, 'span'),
    text('log-message', entry.message, 'span'),
  );
  return li;
}

export function createRenderer(root: HTMLElement): (view: DemoView) => void {
  const scenarioButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-scenario]')];
  const bars = [...root.querySelectorAll<HTMLElement>('[data-bar]')];
  const el = {
    play: one<HTMLButtonElement>(root, '[data-play]'),
    link: one<HTMLButtonElement>(root, '[data-link]'),
    reading: one<HTMLElement>(root, '[data-reading]'),
    label: one<HTMLElement>(root, '[data-label]'),
    detail: one<HTMLElement>(root, '[data-detail]'),
    action: one<HTMLElement>(root, '[data-action]'),
    clock: one<HTMLElement>(root, '[data-clock]'),
    phase: one<HTMLElement>(root, '[data-phase]'),
    sensor: one<HTMLElement>(root, '[data-sensor]'),
    modelScore: one<HTMLElement>(root, '[data-model-score]'),
    linkCell: one<HTMLElement>(root, '[data-link-cell]'),
    queue: one<HTMLElement>(root, '[data-queue]'),
    hr: one<HTMLElement>(root, '[data-hr]'),
    temp: one<HTMLElement>(root, '[data-temp]'),
    quality: one<HTMLElement>(root, '[data-quality]'),
    model: one<HTMLElement>(root, '[data-detector="model"]'),
    baseline: one<HTMLElement>(root, '[data-detector="baseline"]'),
    band: one<SVGPathElement>(root, '[data-band]'),
    line: one<SVGPathElement>(root, '[data-line]'),
    head: one<SVGCircleElement>(root, '[data-head]'),
    cursor: one<SVGLineElement>(root, '[data-cursor]'),
    linkStatus: one<HTMLElement>(root, '[data-link-status]'),
    events: one<HTMLElement>(root, '[data-events]'),
    empty: one<HTMLElement>(root, '[data-empty]'),
    log: one<HTMLElement>(root, '[data-log]'),
    logCount: one<HTMLElement>(root, '[data-log-count]'),
  };

  el.band.setAttribute('d', bandPath());
  let lastEvents = '';
  let loggedEntries = 0;

  return (view) => {
    root.dataset.playing = String(view.playing);
    for (const button of scenarioButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === view.scenario));
    }
    el.play.textContent = view.playing ? 'Pause session' : view.settled ? 'Replay session' : view.elapsed > 0 ? 'Resume session' : 'Start session';
    el.link.setAttribute('aria-checked', String(view.connected));

    // Reading state
    const explanation = view.explanation ?? IDLE;
    el.reading.dataset.state = view.explanation?.state ?? 'idle';
    el.label.textContent = view.elapsed === 0 ? 'Ready when you are' : explanation.label;
    el.detail.textContent =
      view.elapsed === 0 ? 'Choose a scenario, then start a five-minute simulated session.' : explanation.detail;
    el.action.textContent = view.elapsed === 0 ? 'Select Start session to begin.' : explanation.action;

    // Telemetry strip
    const latest = view.latest;
    el.clock.textContent = formatClock(view.elapsed);
    el.phase.textContent = view.finished ? 'Complete' : PHASE_LABEL[latest?.phase ?? 'rest'];
    if (latest === null) setCell(el.sensor, 'Standby', 'idle');
    else if (!latest.contact) setCell(el.sensor, 'No contact', 'warn');
    else if (latest.motion > MAX_MOTION) setCell(el.sensor, 'Movement', 'warn');
    else setCell(el.sensor, 'Contact ok', 'ok');

    const score = view.result?.score ?? null;
    if (view.result === null) setCell(el.modelScore, 'Awaiting data', 'idle');
    else if (score === null) setCell(el.modelScore, 'Not scored', 'warn');
    else setCell(el.modelScore, Math.abs(score).toFixed(1), view.result.deviating ? 'warn' : 'ok');

    setCell(el.linkCell, view.connected ? 'Connected' : 'Offline', view.connected ? 'ok' : 'warn');
    const pending = view.events.filter((item) => item.stage !== 'received').length;
    setCell(el.queue, `${pending} pending`, pending > 0 ? 'warn' : 'idle');

    // Readings
    el.hr.dataset.missingValue = String(latest?.hr == null);
    el.temp.dataset.missingValue = String(latest?.skinTemp == null);
    el.hr.textContent = latest?.hr == null ? 'No data' : String(Math.round(latest.hr));
    el.temp.textContent = latest?.skinTemp == null ? 'No data' : latest.skinTemp.toFixed(1);
    el.quality.textContent = view.result ? QUALITY_LABEL[view.result.quality.reason] : 'Awaiting data';
    paintDetector(el.model, view.result);
    paintDetector(el.baseline, view.baseline);

    // Chart
    el.line.setAttribute('d', linePath(view.samples));
    const cursorX = xAt(view.elapsed).toFixed(1);
    el.cursor.setAttribute('x1', cursorX);
    el.cursor.setAttribute('x2', cursorX);
    const showHead = latest !== null && latest.hr !== null;
    el.head.toggleAttribute('hidden', !showHead);
    if (latest !== null && latest.hr !== null) {
      el.head.setAttribute('cx', xAt(latest.t).toFixed(1));
      el.head.setAttribute('cy', yAt(latest.hr).toFixed(1));
    }

    const spectral = latest?.spectral ?? null;
    bars.forEach((bar, i) => {
      bar.style.setProperty('--level', String(spectral ? spectral[i] : 0));
      bar.dataset.missing = String(spectral === null && view.elapsed > 0);
    });

    // Ground panel
    el.linkStatus.dataset.connected = String(view.connected);
    el.linkStatus.textContent = view.connected ? 'Earth link connected' : 'Earth link offline';
    el.empty.textContent = view.connected ? 'No events to review. Updates will appear here when a change persists.' : 'Earth link offline. Any new events stay on board until the connection returns.';
    const signature = view.events.map((item) => `${item.event.id}:${item.stage}`).join('|');
    if (signature !== lastEvents) {
      lastEvents = signature;
      el.events.replaceChildren(...view.events.map(eventItem));
      el.empty.hidden = view.events.length > 0;
    }

    // System log: append only what is new; start over after a reset.
    if (view.log.length < loggedEntries) {
      el.log.replaceChildren();
      loggedEntries = 0;
    }
    if (view.log.length > loggedEntries) {
      el.log.append(...view.log.slice(loggedEntries).map(logItem));
      loggedEntries = view.log.length;
      el.log.scrollTop = el.log.scrollHeight;
    }
    el.logCount.textContent = String(view.log.length);
  };
}

export interface InsightsPanel {
  show(insights: Insight[], elapsed: number): void;
  hide(): void;
}

export function createInsightsPanel(root: HTMLElement): InsightsPanel {
  const panel = one<HTMLElement>(root, '[data-insights-panel]');
  const list = one<HTMLElement>(root, '[data-insights-list]');
  const time = one<HTMLElement>(root, '[data-insights-time]');

  return {
    show(insights, elapsed) {
      list.replaceChildren(
        ...insights.map((insight) => {
          const item = document.createElement('div');
          item.className = 'insight';
          const value = document.createElement('dd');
          value.append(
            text('insight-value', insight.value, 'span'),
            text('insight-detail', insight.detail, 'span'),
          );
          item.append(text('insight-title', insight.title, 'dt'), value);
          return item;
        }),
      );
      time.textContent = `As of T+${formatClock(elapsed)}`;
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
      list.replaceChildren();
    },
  };
}
