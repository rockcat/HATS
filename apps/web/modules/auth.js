// ── Auth — login overlay, session token, and current-user state ───────────────

export let currentUser = null;

// Patch window.fetch so all /api/* and /events requests automatically carry
// the session token as a Bearer header (avoids relying on HttpOnly cookies).
const _fetch = window.fetch.bind(window);
window.fetch = function patchedFetch(input, init = {}) {
  const token = sessionStorage.getItem('hats_token');
  if (token) {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : (input.url ?? '');
    if (url.startsWith('/api/') || url === '/events') {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
  }
  return _fetch(input, init);
};

export async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) {
      currentUser = await r.json();
      const label = document.getElementById('current-user-label');
      if (label) label.textContent = currentUser.username;
      return true;
    }
    if (r.status === 401) sessionStorage.removeItem('hats_token');
  } catch (err) {
    console.error('[Auth] checkAuth error:', err);
  }
  document.getElementById('login-overlay').hidden = false;
  initLoginForm();
  return false;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  sessionStorage.removeItem('hats_token');
  location.reload();
}

function initLoginForm() {
  const form      = document.getElementById('login-form');
  const errorEl   = document.getElementById('login-error');
  const btn       = document.getElementById('login-btn');
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');

  async function doLogin() {
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    if (!username || !password) return;
    btn.disabled    = true;
    errorEl.hidden  = true;
    btn.textContent = 'Signing in…';
    try {
      const r = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Login failed');
      sessionStorage.setItem('hats_token', data.token);
      location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden      = false;
      btn.disabled        = false;
      btn.textContent     = 'Sign in';
      passwordEl.value    = '';
      passwordEl.focus();
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); doLogin(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !document.getElementById('login-overlay').hidden) doLogin();
  });
  usernameEl.focus();
}
