// ── Email Allowlist panel ─────────────────────────────────────────────────────

import { esc } from './utils.js';

export function renderAllowlist(entries) {
  const el = document.getElementById('allowlist-list');
  if (!el) return;

  const pending = entries.filter(e => e.status === 'pending');
  const badge   = document.getElementById('allowlist-badge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.hidden = pending.length === 0;
  }

  if (entries.length === 0) {
    el.innerHTML = '<p class="allowlist-empty">No email addresses in the allowlist yet.</p>';
    return;
  }

  el.innerHTML = '';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = `allowlist-item allowlist-item--${entry.status}`;

    const timeStr    = new Date(entry.requestedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const reasonHtml = entry.reason ? `<span class="allowlist-reason">${esc(entry.reason)}</span>` : '';
    const byHtml     = `<span class="allowlist-by">by ${esc(entry.requestedBy)}</span>`;

    let actionHtml = '';
    if (entry.status === 'pending') {
      actionHtml = `
        <button class="allowlist-approve-btn" data-email="${esc(entry.email)}">Approve</button>
        <button class="allowlist-reject-btn"  data-email="${esc(entry.email)}">Reject</button>`;
    }

    item.innerHTML = `
      <div class="allowlist-row">
        <span class="allowlist-email">${esc(entry.email)}</span>
        <span class="allowlist-status allowlist-status--${entry.status}">${entry.status}</span>
        ${byHtml}
        <span class="allowlist-time">${timeStr}</span>
        ${actionHtml}
        <button class="allowlist-delete-btn" data-email="${esc(entry.email)}" title="Remove">✕</button>
      </div>
      ${reasonHtml}`;

    item.querySelector('.allowlist-delete-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const email = item.querySelector('.allowlist-delete-btn').dataset.email;
      await fetch(`/api/email-allowlist/${encodeURIComponent(email)}`, { method: 'DELETE' });
    });
    item.querySelector('.allowlist-approve-btn')?.addEventListener('click', async () => {
      const email = item.querySelector('.allowlist-approve-btn').dataset.email;
      await fetch(`/api/email-allowlist/${encodeURIComponent(email)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
    });
    item.querySelector('.allowlist-reject-btn')?.addEventListener('click', async () => {
      const email = item.querySelector('.allowlist-reject-btn').dataset.email;
      await fetch(`/api/email-allowlist/${encodeURIComponent(email)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      });
    });

    el.appendChild(item);
  }
}

export function initAllowlist() {
  const addBtn    = document.getElementById('allowlist-add-btn');
  const emailInp  = document.getElementById('allowlist-add-input');
  const reasonInp = document.getElementById('allowlist-add-reason');
  if (!addBtn || !emailInp) return;

  const doAdd = async () => {
    const email  = emailInp.value.trim();
    const reason = reasonInp?.value.trim() || undefined;
    if (!email) return;
    addBtn.disabled = true;
    try {
      await fetch('/api/email-allowlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason }),
      });
      emailInp.value  = '';
      if (reasonInp) reasonInp.value = '';
    } finally {
      addBtn.disabled = false;
    }
  };

  addBtn.addEventListener('click', doAdd);
  emailInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

  fetch('/api/email-allowlist').then(r => r.json()).then(renderAllowlist).catch(() => {});
}
