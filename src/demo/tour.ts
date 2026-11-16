/**
 * A short guided tour of the simulator for people who are not engineers. It
 * points at one part of the screen at a time and says, in plain words, what
 * that part is for. It never blocks the page: every control keeps working.
 */

export interface TourStep {
  /** Selector, inside the simulator, of the part this step points at. */
  target: string;
  title: string;
  text: string;
}

export const TOUR: TourStep[] = [
  {
    target: '.demo-scenarios',
    title: 'Pick a story',
    text: 'Four astronauts on the way to Mars each wear a wristband. Nothing here is a real person: this is a rehearsal with made-up readings. Each button is a different story, such as a loose band or a slow recovery after exercise.',
  },
  {
    target: '.crew',
    title: 'The crew at a glance',
    text: 'One card per astronaut. OK means the readings look like that person usually does. Warn means something is off and is being watched. Alert means it stayed off long enough to deserve a check. Select a card to see that astronaut in detail.',
  },
  {
    target: '.panel-astronaut .reading',
    title: 'What the astronaut is told',
    text: 'The computer on board reads the wristband and answers right away, without asking Earth. It says what it noticed, what probably caused it, and what to do next. It never names an illness: it only asks for a check.',
  },
  {
    target: '.panel-link .path',
    title: 'Earth is far away',
    text: 'A message to Earth travels at the speed of light and still takes minutes. Each dot on this line is a message on its way. Alerts go first. Sometimes the link is down for hours or days, and messages wait safely on board.',
  },
  {
    target: '.panel-ground',
    title: 'What Earth sees, later',
    text: 'The ground team gets the news one trip later. Each alert shows when it happened and when it arrived. The chart shows how well Earth can picture the astronaut from the little that was sent.',
  },
  {
    target: '[data-play]',
    title: 'Now run it',
    text: 'Select Start session. Five minutes of readings play in thirty seconds, then time speeds up so you can watch the messages reach Earth. Try the switches under "Disturb the link" to see what happens when the connection gets worse.',
  },
];

const SEEN_KEY = 'spectra:tour-seen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function remember() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage is unavailable: the tour simply offers itself again next visit.
  }
}

export interface Tour {
  open(): void;
  close(): void;
  /** Opens the tour for a first-time visitor; does nothing for a returning one. */
  offer(): void;
}

export function createTour(root: HTMLElement, steps: TourStep[] = TOUR): Tour {
  const card = root.querySelector<HTMLElement>('[data-tour]');
  const opener = root.querySelector<HTMLButtonElement>('[data-tour-open]');
  if (!card) return { open() {}, close() {}, offer() {} };

  const title = card.querySelector<HTMLElement>('[data-tour-title]')!;
  const body = card.querySelector<HTMLElement>('[data-tour-text]')!;
  const count = card.querySelector<HTMLElement>('[data-tour-count]')!;
  const back = card.querySelector<HTMLButtonElement>('[data-tour-back]')!;
  const next = card.querySelector<HTMLButtonElement>('[data-tour-next]')!;
  const skip = card.querySelector<HTMLButtonElement>('[data-tour-skip]')!;
  let index = 0;
  let marked: HTMLElement | null = null;

  const unmark = () => {
    marked?.removeAttribute('data-tour-on');
    marked = null;
  };

  const show = (step: number, scroll = true) => {
    index = Math.min(Math.max(step, 0), steps.length - 1);
    const current = steps[index];
    title.textContent = current.title;
    body.textContent = current.text;
    count.textContent = `${index + 1} of ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';

    unmark();
    marked = root.querySelector<HTMLElement>(current.target);
    if (marked) {
      marked.setAttribute('data-tour-on', '');
      if (!scroll) return;
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // On a narrow screen the card covers the lower half, so the target goes to the top.
      const narrow = window.innerWidth < 720;
      marked.scrollIntoView({ block: narrow ? 'start' : 'center', behavior: calm ? 'auto' : 'smooth' });
    }
  };

  const close = () => {
    if (card.hidden) return;
    card.hidden = true;
    unmark();
    remember();
    opener?.setAttribute('aria-expanded', 'false');
    opener?.focus({ preventScroll: true });
  };

  const open = () => {
    card.hidden = false;
    opener?.setAttribute('aria-expanded', 'true');
    show(0);
    next.focus({ preventScroll: true });
  };

  back.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => {
    if (index < steps.length - 1) return show(index + 1);
    const last = marked;
    close();
    last?.focus({ preventScroll: true });
  });
  skip.addEventListener('click', close);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  opener?.addEventListener('click', () => (card.hidden ? open() : close()));

  return {
    open,
    close,
    offer() {
      if (seen()) return;
      card.hidden = false;
      opener?.setAttribute('aria-expanded', 'true');
      // On arrival the page stays where it is; the first step is at the top anyway.
      show(0, false);
    },
  };
}
