import { sessionInsights } from '../sim/insights';
import type { CrewId } from '../sim/scenarios';
import { createDemo } from './controller';
import { createInsightsPanel, createRenderer } from './render';
import { createTour } from './tour';

/** Real milliseconds per simulated second: a 300 s session plays in 30 s. */
const TICK_MS = 100;
/** Simulated seconds per tick once the session is over and only the link is moving. */
const DELIVERY_SECONDS = 20;

function init(root: HTMLElement) {
  const demo = createDemo();
  const render = createRenderer(root);
  const insights = createInsightsPanel(root);
  const logPanel = root.querySelector<HTMLElement>('[data-log-panel]');
  const focusButton = root.querySelector<HTMLButtonElement>('[data-fullscreen]')!;
  const originalParent = root.parentElement!;
  const nextSibling = root.nextSibling;
  const focusDialog = document.createElement('dialog');
  focusDialog.className = 'demo-focus';
  focusDialog.id = 'mission-focus';
  focusDialog.setAttribute('aria-label', 'Mission simulator focus mode');
  focusButton.setAttribute('aria-controls', focusDialog.id);
  focusButton.setAttribute('aria-pressed', 'false');
  document.body.append(focusDialog);
  focusDialog.addEventListener('close', () => {
    originalParent.insertBefore(root, nextSibling);
    document.body.classList.remove('demo-focused');
    focusButton.textContent = 'Focus mode';
    focusButton.setAttribute('aria-pressed', 'false');
    focusButton.focus({ preventScroll: true });
  });
  let timer: number | undefined;

  const paint = () => render(demo.view());

  const stop = () => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    demo.pause();
  };

  /** Runs the clock: one second per tick during the session, faster once only the link is moving. */
  const run = () => {
    demo.play();
    timer ??= window.setInterval(() => {
      const view = demo.view();
      if (!view.finished) demo.step();
      else if (view.link.available && !view.settled) demo.advance(DELIVERY_SECONDS);
      // Nothing can move until the link is back: wait for the operator.
      if (demo.view().finished && (demo.view().settled || !demo.view().link.available)) stop();
      paint();
    }, TICK_MS);
  };

  const restart = () => {
    stop();
    demo.reset();
    insights.hide();
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (!button || !root.contains(button) || button.closest('[data-tour]') || 'tourOpen' in button.dataset) return;
    const data = button.dataset;

    if (data.scenario) {
      stop();
      demo.select(data.scenario);
      insights.hide();
      // Selecting a scenario prepares it; starting remains an explicit action.
    } else if (data.crew) {
      demo.selectCrew(data.crew as CrewId);
    } else if (data.raw) {
      demo.requestRaw(data.raw);
      run();
    } else if ('play' in data) {
      if (demo.view().playing) stop();
      else {
        if (demo.view().finished) restart();
        run();
      }
    } else if ('reset' in data) {
      restart();
    } else if ('deliver' in data) {
      run();
    } else if ('contact' in data) {
      demo.advanceToContact();
      run();
    } else if ('link' in data) {
      demo.setConnected(!demo.view().link.switchOn);
      if (demo.view().finished && demo.view().link.available) run();
    } else if ('loss' in data) {
      demo.setLossInjected(!demo.view().link.lossInjected);
    } else if ('rate' in data) {
      demo.setDegraded(!demo.view().link.degraded);
    } else if ('fullscreen' in data) {
      if (focusDialog.open) focusDialog.close();
      else {
        focusDialog.append(root);
        focusDialog.showModal();
        document.body.classList.add('demo-focused');
        focusButton.textContent = 'Exit focus mode';
        focusButton.setAttribute('aria-pressed', 'true');
        focusButton.focus();
      }
    } else if ('logs' in data && logPanel) {
      const open = logPanel.hidden;
      logPanel.hidden = !open;
      button.setAttribute('aria-pressed', String(open));
      button.textContent = open ? 'Hide event stream' : 'Show event stream';
    } else if ('insights' in data) {
      const view = demo.view();
      insights.show(
        sessionInsights(view.samples, view.results, {
          total: view.incidents.length,
          received: view.incidents.filter((item) => item.stage === 'received').length,
        }),
        view.clock,
      );
    }
    paint();
  });

  root.querySelector<HTMLInputElement>('[data-date]')?.addEventListener('change', (event) => {
    const { value } = event.target as HTMLInputElement;
    if (value) demo.setMissionDate(value);
    paint();
  });

  root.hidden = false;
  paint();
  createTour(root).offer();
}

const root = document.querySelector<HTMLElement>('[data-demo]');
if (root) init(root);
