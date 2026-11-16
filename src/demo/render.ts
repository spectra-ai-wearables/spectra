import { CAUSE_LABEL } from '../sim/cause';
import { formatClock } from '../sim/format';
import type { Insight } from '../sim/insights';
import type { Transfer, TransferStage } from '../sim/link';
import type { MonitorState } from '../sim/monitor';
import { MAX_MOTION } from '../sim/quality';
import type { TwinEstimate } from '../sim/twin';
import type { Phase, QualityReason, WindowResult } from '../sim/types';
import { CHART, bandPath, linePath, xAt, yAt } from './chart';
import type { DemoView, GroundIncident, LogEntry } from './controller';

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

const STAGE_LABEL: Record<TransferStage, string> = {
  saved: 'Saved on board',
  waiting: 'Waiting for the link',
  sending: 'Sending',
  'in-flight': 'On its way',
  repair: 'Resend scheduled',
  received: 'Received on ground',
};

const MONITOR_LABEL: Record<MonitorState | 'idle', string> = {
  idle: 'Standby',
  ok: 'OK',
  warn: 'Warn',
  alert: 'Alert',
  'no-data': 'No data',
};

const RAW_LABEL: Record<GroundIncident['raw'], string> = {
  none: 'Request raw windows',
  requested: 'Request on its way to the spacecraft',
  'in-transit': 'Raw windows on their way',
  received: 'Raw windows received',
};

const IDLE = {
  label: 'Reading your signals',
  detail: 'Spectra needs ten seconds of readings before it compares them with your pattern.',
  action: 'Keep the band on.',
};

/** Score at which the meter is full; the threshold of 3 sits at a quarter. */
const METER_MAX = 12;
/** Deviation at which a heat cell is at full strength. */
const HEAT_MAX = 6;
const SVG = 'http://www.w3.org/2000/svg';

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

/** A span of simulated time in words: seconds up to days. */
export function formatSpan(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  return `${(seconds / 86_400).toFixed(1)} days`;
}

/** The mission clock: mm:ss during the session, then days once time is advanced. */
export function formatMission(seconds: number): string {
  if (seconds < 86_400) return formatClock(seconds);
  const rest = seconds % 86_400;
  return `${Math.floor(seconds / 86_400)} d ${Math.floor(rest / 3600)} h ${Math.floor((rest % 3600) / 60)} min`;
}

const formatBytes = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`);

function paintDetector(element: HTMLElement, result: WindowResult | null) {
  const score = result?.score ?? null;
  const verdict =
    result === null
      ? { key: 'none', text: '' }
      : result.state === 'insufficient-data'
        ? { key: 'none', text: 'not scored: unreliable data' }
        : result.state === 'change-to-verify'
          ? { key: 'verify', text: 'raises an alert' }
          : result.deviating
            ? { key: 'watch', text: 'above threshold, watching' }
            : { key: 'ok', text: 'within pattern' };

  element.dataset.verdict = verdict.key;
  one<HTMLElement>(element, '[data-score]').textContent =
    score === null ? (result === null ? 'Awaiting data' : 'Not scored') : Math.abs(score).toFixed(1);
  one<HTMLElement>(element, '[data-verdict-text]').textContent = verdict.text;
  element.style.setProperty('--fill', String(score === null ? 0 : Math.min(Math.abs(score) / METER_MAX, 1)));
}

function incidentItem(item: GroundIncident, now: number): HTMLLIElement {
  const { incident } = item;
  const li = document.createElement('li');
  li.className = 'event';
  li.dataset.stage = item.stage;
  const who = incident.crew.length === 1 ? incident.crew[0] : `${incident.crew.length} crew: ${incident.crew.join(', ')}`;
  const clocks =
    item.receivedAt === null
      ? `Event time T+${formatMission(incident.firstAt)} · not yet on the ground`
      : `Event time T+${formatMission(incident.firstAt)} · received T+${formatMission(item.receivedAt)} · ${formatSpan(now - incident.firstAt)} old`;
  li.append(
    text('event-stage', STAGE_LABEL[item.stage]),
    text('event-title', `${who}: ${incident.alerts[0].title.toLowerCase()}`),
    text('event-cause', `Likely cause: ${CAUSE_LABEL[incident.cause].toLowerCase()}`),
    text('event-detail', incident.alerts[0].detail),
    text('event-time', clocks),
  );
  if (incident.suppressed > 0) {
    li.append(text('event-suppressed', `${incident.suppressed} more ${incident.suppressed === 1 ? 'alert' : 'alerts'} folded into this incident`));
  }
  if (item.stage === 'received') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-action';
    button.dataset.raw = incident.id;
    button.textContent = RAW_LABEL[item.raw];
    button.disabled = item.raw !== 'none';
    li.append(button);
  }
  return li;
}

function transferRow(item: Transfer, now: number): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.dataset.stage = item.stage;
  const status =
    item.stage === 'in-flight' && item.arrivesAt !== null
      ? `${STAGE_LABEL[item.stage]}, ${formatSpan(Math.max(0, item.arrivesAt - now))} to go`
      : item.stage === 'sending'
        ? `${STAGE_LABEL[item.stage]} ${item.sent}/${item.planned} packets`
        : STAGE_LABEL[item.stage];
  const name = document.createElement('th');
  name.scope = 'row';
  name.append(text('priority', `P${item.message.priority}`, 'span'), ` ${item.message.label}`);
  row.append(name, text('', formatBytes(item.message.bytes), 'td'), text('', status, 'td'));
  return row;
}

function logItem(entry: LogEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.level = entry.level;
  li.append(
    text('log-time', formatMission(entry.t), 'time'),
    text('log-source', entry.source, 'span'),
    text('log-message', entry.message, 'span'),
  );
  return li;
}

/** One rectangle per window: the range the ground can vouch for. */
function twinBand(estimate: TwinEstimate): SVGRectElement {
  const rect = document.createElementNS(SVG, 'rect');
  const x = xAt(estimate.w * 10);
  const top = CHART.top;
  const bottom = CHART.height - CHART.bottom;
  const high = estimate.high === null ? top : Math.max(top, yAt(Math.min(estimate.high, CHART.maxHr)));
  const low = estimate.low === null ? bottom : Math.min(bottom, yAt(Math.max(estimate.low, CHART.minHr)));
  rect.setAttribute('class', `twin-band twin-${estimate.basis}`);
  rect.setAttribute('x', x.toFixed(1));
  rect.setAttribute('width', (xAt(estimate.w * 10 + 10) - x).toFixed(1));
  rect.setAttribute('y', high.toFixed(1));
  rect.setAttribute('height', Math.max(1, low - high).toFixed(1));
  return rect;
}

function twinLine(estimates: TwinEstimate[]): string {
  let path = '';
  let pen = false;
  for (const estimate of estimates) {
    if (estimate.hr === null) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${xAt(estimate.w * 10 + 5).toFixed(1)} ${yAt(estimate.hr).toFixed(1)}`;
    pen = true;
  }
  return path;
}

export function createRenderer(root: HTMLElement): (view: DemoView) => void {
  const scenarioButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-scenario]')];
  const crewCards = [...root.querySelectorAll<HTMLButtonElement>('[data-crew]')];
  const bars = [...root.querySelectorAll<HTMLElement>('[data-bar]')];
  const el = {
    play: one<HTMLButtonElement>(root, '[data-play]'),
    deliver: one<HTMLButtonElement>(root, '[data-deliver]'),
    link: one<HTMLButtonElement>(root, '[data-link]'),
    loss: one<HTMLButtonElement>(root, '[data-loss]'),
    rate: one<HTMLButtonElement>(root, '[data-rate]'),
    date: one<HTMLInputElement>(root, '[data-date]'),
    watch: one<HTMLElement>(root, '[data-watch]'),
    basis: one<HTMLElement>(root, '[data-basis]'),
    basisBadge: one<HTMLElement>(root, '[data-basis-badge]'),
    selectedName: one<HTMLElement>(root, '[data-selected-name]'),
    reading: one<HTMLElement>(root, '[data-reading]'),
    label: one<HTMLElement>(root, '[data-label]'),
    detail: one<HTMLElement>(root, '[data-detail]'),
    causeLine: one<HTMLElement>(root, '[data-cause-line]'),
    cause: one<HTMLElement>(root, '[data-cause]'),
    action: one<HTMLElement>(root, '[data-action]'),
    clock: one<HTMLElement>(root, '[data-clock]'),
    phase: one<HTMLElement>(root, '[data-phase]'),
    delay: one<HTMLElement>(root, '[data-delay]'),
    linkCell: one<HTMLElement>(root, '[data-link-cell]'),
    queue: one<HTMLElement>(root, '[data-queue]'),
    budget: one<HTMLElement>(root, '[data-quality-budget]'),
    hr: one<HTMLElement>(root, '[data-hr]'),
    temp: one<HTMLElement>(root, '[data-temp]'),
    quality: one<HTMLElement>(root, '[data-quality]'),
    model: one<HTMLElement>(root, '[data-detector="model"]'),
    baseline: one<HTMLElement>(root, '[data-detector="baseline"]'),
    band: one<SVGPathElement>(root, '[data-band]'),
    line: one<SVGPathElement>(root, '[data-line]'),
    head: one<SVGCircleElement>(root, '[data-head]'),
    cursor: one<SVGLineElement>(root, '[data-cursor]'),
    path: one<HTMLElement>(root, '[data-path]'),
    pathLabel: one<HTMLElement>(root, '[data-path-label]'),
    track: one<HTMLElement>(root, '[data-track]'),
    distance: one<HTMLElement>(root, '[data-distance]'),
    rateValue: one<HTMLElement>(root, '[data-rate-value]'),
    lost: one<HTMLElement>(root, '[data-lost]'),
    blackout: one<HTMLElement>(root, '[data-blackout]'),
    contact: one<HTMLButtonElement>(root, '[data-contact]'),
    transfers: one<HTMLElement>(root, '[data-transfers]'),
    transfersEmpty: one<HTMLElement>(root, '[data-transfers-empty]'),
    linkStatus: one<HTMLElement>(root, '[data-link-status]'),
    events: one<HTMLElement>(root, '[data-events]'),
    empty: one<HTMLElement>(root, '[data-empty]'),
    twinBands: one<SVGGElement>(root, '[data-twin-bands]'),
    twinLine: one<SVGPathElement>(root, '[data-twin-line]'),
    bytesSent: one<HTMLElement>(root, '[data-bytes-sent]'),
    bytesRaw: one<HTMLElement>(root, '[data-bytes-raw]'),
    bytesSaved: one<HTMLElement>(root, '[data-bytes-saved]'),
    ledgerHead: one<HTMLElement>(root, '[data-ledger-head]'),
    ledgerVerified: one<HTMLElement>(root, '[data-ledger-verified]'),
    ledgerDuplicates: one<HTMLElement>(root, '[data-ledger-duplicates]'),
    log: one<HTMLElement>(root, '[data-log]'),
    logCount: one<HTMLElement>(root, '[data-log-count]'),
  };

  el.band.setAttribute('d', bandPath());
  let lastEvents = '';
  let lastTransfers = '';
  let lastTwin = '';
  let loggedEntries = 0;

  return (view) => {
    root.dataset.playing = String(view.playing);
    root.dataset.finished = String(view.finished);
    for (const button of scenarioButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.scenario === view.scenario.id));
    }
    el.play.textContent = view.playing ? 'Pause session' : view.finished ? 'Replay session' : view.elapsed > 0 ? 'Resume session' : 'Start session';
    el.deliver.hidden = !view.finished || view.settled || !view.link.available;
    el.link.setAttribute('aria-checked', String(view.link.switchOn));
    el.loss.setAttribute('aria-checked', String(view.link.lossInjected));
    el.rate.setAttribute('aria-checked', String(view.link.degraded));
    if (document.activeElement !== el.date) el.date.value = view.mission.date;
    el.watch.textContent = view.scenario.watch;
    el.basis.textContent = view.scenario.basis.text;
    el.basisBadge.dataset.kind = view.scenario.basis.kind;
    el.basisBadge.textContent = view.scenario.basis.kind === 'data' ? 'Open data' : 'Synthetic';

    // Crew
    for (const button of crewCards) {
      const card = view.crew.find((item) => item.id === button.dataset.crew)!;
      const pressed = card.id === view.selected;
      button.setAttribute('aria-pressed', String(pressed));
      button.dataset.state = card.state;
      one<HTMLElement>(button, '[data-crew-state]').textContent = card.trending ? 'Warn: trend' : MONITOR_LABEL[card.state];
      one<HTMLElement>(button, '[data-crew-cause]').textContent = card.cause ? CAUSE_LABEL[card.cause] : '';
      const heat = one<HTMLElement>(button, '[data-heat]');
      for (let i = heat.childElementCount; i < card.heat.length; i++) {
        const value = card.heat[i];
        const cell = document.createElement('i');
        if (value === null) cell.dataset.missing = 'true';
        else cell.style.setProperty('--v', String(Math.min(1, value / HEAT_MAX).toFixed(2)));
        if (value !== null && value >= 3) cell.dataset.over = 'true';
        heat.append(cell);
      }
      if (card.heat.length < heat.childElementCount) heat.replaceChildren();
      if (pressed) el.selectedName.textContent = card.role;
    }

    // Reading state
    const explanation = view.explanation ?? IDLE;
    el.reading.dataset.state = view.explanation?.state ?? 'idle';
    el.label.textContent = view.elapsed === 0 ? 'Ready when you are' : explanation.label;
    el.detail.textContent =
      view.elapsed === 0 ? 'Choose a scenario, then start a five-minute simulated session.' : explanation.detail;
    el.action.textContent = view.elapsed === 0 ? 'Select Start session to begin.' : explanation.action;
    el.causeLine.hidden = view.cause === null;
    el.cause.textContent = view.cause ? CAUSE_LABEL[view.cause] : '';

    // Telemetry strip
    const latest = view.latest;
    el.clock.textContent = formatMission(view.clock);
    el.phase.textContent = view.finished ? 'Complete' : PHASE_LABEL[latest?.phase ?? 'rest'];
    el.delay.textContent = view.mission.day ? formatSpan(view.link.delay) : 'No data';
    setCell(
      el.linkCell,
      view.link.reason === 'blackout' ? 'Solar blackout' : view.link.reason === 'switched-off' ? 'Off' : view.link.loss > 0 || view.link.degraded || view.link.disturbed ? 'Degraded' : 'Up',
      view.link.available && view.link.loss === 0 && !view.link.degraded ? 'ok' : 'warn',
    );
    const unsent = view.transfers.filter((item) => item.stage !== 'received' && item.stage !== 'in-flight').length;
    setCell(el.queue, String(unsent), unsent > 0 ? 'warn' : 'idle');
    if (view.quality.total === 0) setCell(el.budget, 'Awaiting data', 'idle');
    else {
      const share = view.quality.reliable / view.quality.total;
      setCell(el.budget, `${Math.round(share * 100)}% of ${Math.round(view.quality.target * 100)}% target`, share >= view.quality.target ? 'ok' : 'warn');
    }

    // Readings
    el.hr.dataset.missingValue = String(latest?.hr == null);
    el.temp.dataset.missingValue = String(latest?.skinTemp == null);
    el.hr.textContent = latest?.hr == null ? 'No data' : String(Math.round(latest.hr));
    el.temp.textContent = latest?.skinTemp == null ? 'No data' : latest.skinTemp.toFixed(1);
    el.quality.textContent =
      latest === null
        ? 'Awaiting data'
        : !latest.contact
          ? QUALITY_LABEL['no-contact']
          : latest.motion > MAX_MOTION
            ? QUALITY_LABEL.motion
            : view.result
              ? QUALITY_LABEL[view.result.quality.reason]
              : 'Awaiting data';
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

    // Link
    const day = view.mission.day;
    el.path.dataset.state = view.link.available ? (view.link.loss > 0 || view.link.degraded ? 'degraded' : 'up') : 'down';
    el.pathLabel.textContent = day ? `${formatSpan(view.link.delay)} at the speed of light` : 'No ephemeris for this date';
    el.distance.textContent = day ? `${(day.distanceKm / 1e6).toFixed(1)} million km` : 'No data';
    el.rateValue.textContent = `${((view.link.bytesPerSecond * 8) / 1000).toFixed(view.link.bytesPerSecond < 100 ? 2 : 0)} kb/s`;
    el.lost.textContent = String(view.bytes.packetsLost);
    const blackout = view.mission.blackout;
    el.blackout.hidden = blackout === null;
    if (blackout) {
      el.blackout.textContent = `Solar conjunction: the Sun is within 2° of the line of sight from ${blackout.start} to ${blackout.end}. No link for ${blackout.days} days.`;
    }
    el.contact.hidden = blackout === null || !view.finished;

    const inFlight = view.transfers.filter((item) => item.stage === 'in-flight' && item.departedAt !== null && item.arrivesAt !== null);
    while (el.track.childElementCount > inFlight.length) el.track.lastElementChild!.remove();
    while (el.track.childElementCount < inFlight.length) el.track.append(document.createElement('i'));
    inFlight.forEach((item, i) => {
      const dot = el.track.children[i] as HTMLElement;
      const span = Math.max(1, item.arrivesAt! - item.departedAt!);
      dot.dataset.priority = String(item.message.priority);
      dot.style.setProperty('--p', Math.min(1, Math.max(0, (view.clock - item.departedAt!) / span)).toFixed(3));
    });

    const ordered = [...view.transfers].sort(
      (a, b) => Number(a.stage === 'received') - Number(b.stage === 'received') || a.message.priority - b.message.priority || a.message.createdAt - b.message.createdAt,
    );
    const transferKey = ordered.map((item) => `${item.message.id}:${item.stage}:${item.sent}:${item.stage === 'in-flight' ? view.clock : ''}`).join('|');
    if (transferKey !== lastTransfers) {
      lastTransfers = transferKey;
      el.transfers.replaceChildren(...ordered.map((item) => transferRow(item, view.clock)));
      el.transfersEmpty.hidden = ordered.length > 0;
    }

    // Ground panel
    el.linkStatus.dataset.connected = String(view.link.available);
    el.linkStatus.textContent = view.link.available ? 'Earth link up' : view.link.reason === 'blackout' ? 'Solar blackout' : 'Earth link off';
    el.empty.textContent = view.link.available
      ? 'No incidents. An alert appears here once it has crossed the distance.'
      : 'No link. New alerts stay on board until it returns.';
    const visible = view.incidents;
    const signature = visible.map((item) => `${item.incident.id}:${item.stage}:${item.raw}:${item.incident.suppressed}:${item.stage === 'received' ? Math.floor(view.clock / 10) : ''}`).join('|');
    if (signature !== lastEvents) {
      lastEvents = signature;
      const focused = (document.activeElement as HTMLElement | null)?.dataset?.raw;
      el.events.replaceChildren(...visible.map((item) => incidentItem(item, view.clock)));
      el.empty.hidden = visible.length > 0;
      if (focused) el.events.querySelector<HTMLElement>(`[data-raw="${focused}"]`)?.focus();
    }

    const twinKey = `${view.selected}|${view.twin.map((estimate) => estimate.basis[2]).join('')}`;
    if (twinKey !== lastTwin) {
      lastTwin = twinKey;
      el.twinBands.replaceChildren(...view.twin.map(twinBand));
      el.twinLine.setAttribute('d', twinLine(view.twin));
    }

    el.bytesSent.textContent = formatBytes(view.bytes.sent);
    el.bytesRaw.textContent = formatBytes(view.bytes.raw);
    el.bytesSaved.textContent = view.bytes.raw > 0 && view.bytes.sent > 0 ? `${Math.round((1 - view.bytes.sent / view.bytes.raw) * 100)}%` : '—';
    el.ledgerHead.textContent = String(view.ledger.head);
    el.ledgerVerified.textContent = `${view.ledger.verified} of ${view.ledger.head}`;
    el.ledgerDuplicates.textContent = String(view.ledger.duplicates);

    // Event stream: append only what is new; start over after a reset.
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
  show(insights: Insight[], clock: number): void;
  hide(): void;
}

export function createInsightsPanel(root: HTMLElement): InsightsPanel {
  const panel = one<HTMLElement>(root, '[data-insights-panel]');
  const list = one<HTMLElement>(root, '[data-insights-list]');
  const time = one<HTMLElement>(root, '[data-insights-time]');

  return {
    show(insights, clock) {
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
      time.textContent = `As of T+${formatMission(clock)}`;
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
      list.replaceChildren();
    },
  };
}
