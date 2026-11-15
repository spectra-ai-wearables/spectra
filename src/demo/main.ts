import { sessionInsights } from '../sim/insights';
import type { ScenarioId } from '../sim/types';
import { createDemo } from './controller';
import { createInsightsPanel, createRenderer } from './render';

/** Real milliseconds per simulated second: a 300 s session plays in 30 s. */
const TICK_MS = 100;

function init(root: HTMLElement) {
  const demo = createDemo('usual');
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

  const start = () => {
    if (demo.view().settled) {
      demo.reset();
      insights.hide();
    }
    demo.play();
    timer ??= window.setInterval(() => {
      demo.step();
      if (demo.view().settled) stop();
      paint();
    }, TICK_MS);
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (!button || !root.contains(button)) return;

    if (button.dataset.scenario) {
      stop();
      demo.select(button.dataset.scenario as ScenarioId);
      insights.hide();
      // Selecting a scenario prepares it; starting remains an explicit action.
    } else if ('play' in button.dataset) {
      if (demo.view().playing) stop();
      else start();
    } else if ('reset' in button.dataset) {
      stop();
      demo.reset();
      insights.hide();
    } else if ('link' in button.dataset) {
      demo.setConnected(!demo.view().connected);
    } else if ('fullscreen' in button.dataset) {
      if (focusDialog.open) focusDialog.close();
      else {
        focusDialog.append(root);
        focusDialog.showModal();
        document.body.classList.add('demo-focused');
        focusButton.textContent = 'Exit focus mode';
        focusButton.setAttribute('aria-pressed', 'true');
        focusButton.focus();
      }
    } else if ('logs' in button.dataset && logPanel) {
      const open = logPanel.hidden;
      logPanel.hidden = !open;
      button.setAttribute('aria-pressed', String(open));
    } else if ('insights' in button.dataset) {
      const view = demo.view();
      insights.show(sessionInsights(view.samples, view.results, view.events), view.elapsed);
    }
    paint();
  });

  root.hidden = false;
  paint();
}

const root = document.querySelector<HTMLElement>('[data-demo]');
if (root) init(root);
