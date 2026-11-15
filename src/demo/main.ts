import type { ScenarioId } from '../sim/types';
import { createDemo } from './controller';
import { createRenderer } from './render';

/** Real milliseconds per simulated second: a 300 s session plays in 30 s. */
const TICK_MS = 100;

function init(root: HTMLElement) {
  const demo = createDemo('usual');
  const render = createRenderer(root);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    if (demo.view().settled) demo.reset();
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
      if (!reducedMotion) start();
    } else if ('play' in button.dataset) {
      if (demo.view().playing) stop();
      else start();
    } else if ('reset' in button.dataset) {
      stop();
      demo.reset();
    } else if ('link' in button.dataset) {
      demo.setConnected(!demo.view().connected);
    } else if ('fullscreen' in button.dataset) {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void root.requestFullscreen();
    }
    paint();
  });

  root.hidden = false;
  paint();
}

const root = document.querySelector<HTMLElement>('[data-demo]');
if (root) init(root);
