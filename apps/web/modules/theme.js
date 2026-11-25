// theme.js — the dashboard's light or dark look, chosen from the header and remembered.
//
// The page starts dark. index.html applies a remembered choice before the page
// draws, so a light dashboard does not flash dark first; this module keeps the
// header's button in step with it.

export const THEME_KEY = 'dashboardTheme';
const THEMES = ['dark', 'light'];

/** The theme a remembered value asks for: dark unless it names another we have. */
export function themeFrom(saved) {
  return THEMES.includes(saved) ? saved : 'dark';
}

/** The theme the button switches to. */
export function otherTheme(theme) {
  return theme === 'light' ? 'dark' : 'light';
}

const current = () => themeFrom(document.documentElement.dataset.theme);

function showButton(theme) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const next = otherTheme(theme);
  btn.title = `Switch to the ${next} theme`;
  btn.setAttribute('aria-label', btn.title);
  btn.querySelector('img').src = `assets/${next}-mode.svg`;
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* not kept */ }
  showButton(theme);
}

export function initTheme() {
  showButton(current());
  document.getElementById('theme-btn')?.addEventListener('click', () => applyTheme(otherTheme(current())));
}
