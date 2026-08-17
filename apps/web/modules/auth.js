// ── Auth — login overlay and current-user state ───────────────────────────────

export let currentUser = null;

export async function checkAuth() {
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) {
      currentUser = await r.json();
      document.getElementById('current-user-label').textContent = currentUser.username;
      return true;
    }
  } catch { /* network error — fall through */ }
  document.getElementById('login-overlay').hidden = false;
  initLoginForm();
  return false;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
}

function initLoginForm() {
  const form     = document.getElementById('login-form');
  const errorEl  = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');

  async function doLogin() {
    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    if (!username || !password) return;
    btn.disabled     = true;
    errorEl.hidden   = true;
    btn.textContent  = 'Signing in…';
    try {
      const r    = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Login failed');
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
