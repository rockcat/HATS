// nav.js — the section menu down the left, and the one section it shows.
//
// Every section has the whole of the page to itself, so there is nothing to
// expand. The menu folds down to its icons; which section was open, and
// whether the menu was folded, are kept for next time in this browser.

import { fetchMCPCatalogue } from './mcp.js';
import { fetchGlobalAgents } from './library.js';
import { fetchScheduledActions } from './schedules.js';
import { fetchVisits } from './visits.js';

const VIEW_KEY = 'dashboardView';
const FOLDED_KEY = 'dashboardNavFolded';
const BACKLOG_KEY = 'dashboardBacklogHeight';
const DEFAULT_VIEW = 'agents';

/** What a section loads each time it is shown. */
const ON_SHOW = {
  mcp:       () => fetchMCPCatalogue(),
  library:   () => fetchGlobalAgents(),
  schedules: () => fetchScheduledActions(),
  visits:    () => void fetchVisits(),
  calendar:  () => import('./calendar.js').then(m => m.fetchCalendar()),
  cli:       () => document.getElementById('cli-input')?.focus(),
  settings:  () => import('./settings.js').then(m => m.openSettings()),
};

const remembered = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* not kept */ } };

const views = () => [...document.querySelectorAll('#view-host > .view')];
const items = () => [...document.querySelectorAll('.side-nav-item')];

/** Show one section, by the name its menu item carries. */
export function showView(name) {
  const known = views().some(v => v.dataset.view === name);
  const view = known ? name : DEFAULT_VIEW;
  for (const v of views()) v.classList.toggle('active', v.dataset.view === view);
  for (const b of items()) {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  remember(VIEW_KEY, view);
  ON_SHOW[view]?.();
}

function setFolded(folded) {
  document.body.classList.toggle('nav-folded', folded);
  const toggle = document.getElementById('side-nav-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!folded));
    toggle.title = folded ? 'Show the menu names' : 'Fold the menu to icons';
    toggle.querySelector('img').src = folded ? 'assets/menu.svg' : 'assets/menu-close.svg';
  }
  remember(FOLDED_KEY, folded ? '1' : '0');
}

/** The backlog's height, kept between the least and most that leave both parts usable. */
export function clampBacklog(px, boardHeight) {
  const min = 80;
  const max = Math.max(min, boardHeight - 160);
  return Math.round(Math.min(max, Math.max(min, px)));
}

function initBacklogResizer() {
  const board = document.querySelector('.view--board');
  const handle = document.getElementById('backlog-resizer');
  if (!board || !handle) return;
  const apply = (px) => board.style.setProperty('--backlog-height', `${clampBacklog(px, board.clientHeight)}px`);
  const saved = Number(remembered(BACKLOG_KEY));
  if (saved > 0) board.style.setProperty('--backlog-height', `${saved}px`);

  const save = () => {
    const h = parseInt(getComputedStyle(board).getPropertyValue('--backlog-height'), 10);
    if (h > 0) remember(BACKLOG_KEY, String(h));
  };

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    board.classList.add('resizing');
    const move = (ev) => apply(board.getBoundingClientRect().bottom - ev.clientY);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      board.classList.remove('resizing');
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  // From the keyboard too: up makes the backlog taller.
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const now = document.getElementById('backlog-panel').getBoundingClientRect().height;
    apply(now + (e.key === 'ArrowUp' ? 24 : -24));
    save();
  });
}

export function initNav() {
  for (const b of items()) b.addEventListener('click', () => showView(b.dataset.view));
  document.getElementById('side-nav-toggle')?.addEventListener('click', () =>
    setFolded(!document.body.classList.contains('nav-folded')));
  setFolded(remembered(FOLDED_KEY) === '1');
  initBacklogResizer();
  showView(remembered(VIEW_KEY) ?? DEFAULT_VIEW);
}
