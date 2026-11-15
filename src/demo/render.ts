import { SESSION_LENGTH } from '../sim/baseline';
import type { EventStage, Phase, QualityReason, QueuedEvent } from '../sim/types';
import { bandPath, linePath, xAt } from './chart';
import type { DemoView } from './controller';

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
  label: 'Collecting the first window',
  detail: 'Spectra needs ten seconds of readings before it compares them with your pattern.',
  action: 'Keep the band on.',
};

function one<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Demo markup is missing ${selector}`);
  return element;
}

const clockText = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function eventItem(item: QueuedEvent): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'event';
  li.dataset.stage = item.stage;

  const stage = document.createElement('p');
  stage.className = 'event-stage';
  stage.textContent = STAGE_LABEL[item.stage];

  const title = document.createElement('p');
  title.className = 'event-title';
  title.textContent = item.event.title;

  const detail = document.createElement('p');
  detail.className = 'event-detail';
  detail.textContent = item.event.detail;

  const time = document.createElement('p');
  time.className = 'event-time';
  time.textContent =
    item.receivedAt === null
      ? `Recorded on board at ${clockText(item.event.createdAt)}`
      : `Recorded on board at ${clockText(item.event.createdAt)} · received at ${clockText(item.receivedAt)}`;

  li.append(stage, title, detail, time);
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
    hr: one<HTMLElement>(root, '[data-hr]'),
    temp: one<HTMLElement>(root, '[data-temp]'),
    quality: one<HTMLElement>(root, '[data-quality]'),
    band: one<SVGPathElement>(root, '[data-band]'),
    line: one<SVGPathElement>(root, '[data-line]'),
    cursor: one<SVGLineElement>(root, '[data-cursor]'),
    linkStatus: one<HTMLElement>(root, '[data-link-status]'),
    events: one<HTMLElement>(root, '[data-events]'),
    empty: one<HTMLElement>(root, '[data-empty]'),
  };

  el.band.setAttribute('d', bandPath());
  let lastEvents = '';

  return (view) => {
    for (const button of scenarioButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === view.scenario));
    }
    el.play.textContent = view.playing ? 'Pause' : view.settled ? 'Replay' : 'Play';
    el.link.setAttribute('aria-checked', String(view.connected));

    const text = view.explanation ?? IDLE;
    el.reading.dataset.state = view.explanation?.state ?? 'idle';
    el.label.textContent = text.label;
    el.detail.textContent =
      view.elapsed === 0 ? 'Press play to start the session.' : text.detail;
    el.action.textContent = view.elapsed === 0 ? '—' : text.action;

    el.clock.textContent = view.finished
      ? `${clockText(SESSION_LENGTH)} · session complete`
      : clockText(view.elapsed);
    el.phase.textContent = PHASE_LABEL[view.latest?.phase ?? 'rest'];
    el.hr.textContent = view.latest?.hr == null ? '—' : String(Math.round(view.latest.hr));
    el.temp.textContent = view.latest?.skinTemp == null ? '—' : view.latest.skinTemp.toFixed(1);
    el.quality.textContent = view.result ? QUALITY_LABEL[view.result.quality.reason] : '—';

    el.line.setAttribute('d', linePath(view.samples));
    const cursorX = xAt(view.elapsed).toFixed(1);
    el.cursor.setAttribute('x1', cursorX);
    el.cursor.setAttribute('x2', cursorX);

    const spectral = view.latest?.spectral ?? null;
    bars.forEach((bar, i) => {
      bar.style.setProperty('--level', String(spectral ? spectral[i] : 0));
      bar.dataset.missing = String(spectral === null && view.elapsed > 0);
    });

    el.linkStatus.dataset.connected = String(view.connected);
    el.linkStatus.textContent = view.connected ? 'Link up' : 'No link';

    const signature = view.events.map((item) => `${item.event.id}:${item.stage}`).join('|');
    if (signature !== lastEvents) {
      lastEvents = signature;
      el.events.replaceChildren(...view.events.map(eventItem));
      el.empty.hidden = view.events.length > 0;
    }
  };
}
