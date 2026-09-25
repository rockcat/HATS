// ── Human Requests panel ──────────────────────────────────────────────────────

import { esc } from './utils.js';

/** Fire an action and surface the failure in the row rather than swallowing it. */
async function act(url, errorEl, body) {
  try {
    const init = { method: body === undefined ? 'DELETE' : 'POST' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(url, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) { if (errorEl) errorEl.textContent = data.error ?? `Failed (${r.status})`; return false; }
    return true;
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || 'Failed';
    return false;
  }
}

/** What happened to a settled request. */
function resolvedBody(req) {
  if (req.status === 'dismissed') {
    return `<div class="request-response-display request-response-display--dismissed">
        <span class="request-response-label">Dismissed without an answer</span>
        ${req.dismissalNote ? `<div class="request-response-text">${esc(req.dismissalNote)}</div>` : ''}
      </div>`;
  }
  return `<div class="request-response-display">
      <span class="request-response-label">Your response</span>
      <div class="request-response-text">${esc(req.response ?? '')}</div>
    </div>`;
}

/**
 * The reply box, plus the way out of it.
 *
 * Dismiss is not the same as delete: an agent that escalated sits in
 * `waiting_for_help` until it hears something, so the request has to be closed
 * by telling the agent, not by removing the row.
 */
function pendingBody() {
  return `<div class="request-reply-area" hidden>
      <textarea class="request-reply-input" placeholder="Type your response…" rows="3"></textarea>
      <div class="request-reply-footer">
        <span class="request-reply-error"></span>
        <button class="request-close-btn" title="Leave this request open">Close</button>
        <button class="request-dismiss-btn" title="Tell the agent to carry on without an answer">Dismiss</button>
        <button class="request-reply-submit">Send Reply</button>
      </div>
    </div>`;
}

function statusBadge(req) {
  if (req.status === 'answered') return '<span class="request-done-badge">Answered</span>';
  if (req.status === 'dismissed') return '<span class="request-dismissed-badge">Dismissed</span>';
  return `<span class="request-urgency-badge request-urgency--${req.urgency}">${req.urgency === 'high' ? 'Urgent' : 'Low'}</span>`;
}

function wirePending(item, req) {
  const area = item.querySelector('.request-reply-area');
  const errorEl = item.querySelector('.request-reply-error');
  const input = item.querySelector('.request-reply-input');

  item.addEventListener('click', (e) => {
    if (area.contains(e.target)) return;
    const opening = area.hidden;
    area.hidden = !opening;
    if (opening) input.focus();
  });

  item.querySelector('.request-reply-submit').addEventListener('click', async () => {
    const btn = item.querySelector('.request-reply-submit');
    const response = input.value.trim();
    if (!response) { errorEl.textContent = 'Please enter a response.'; return; }
    btn.disabled = true; btn.textContent = '…'; errorEl.textContent = '';
    await act(`/api/human-requests/${encodeURIComponent(req.id)}/respond`, errorEl, { response });
    btn.disabled = false; btn.textContent = 'Send Reply';
  });

  // Anything typed becomes the note the agent is given instead of an answer.
  item.querySelector('.request-dismiss-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true; errorEl.textContent = '';
    const note = input.value.trim();
    await act(`/api/human-requests/${encodeURIComponent(req.id)}/dismiss`, errorEl,
      note ? { note } : {});
    btn.disabled = false;
  });

  // Just folds the box away — this used to delete the request.
  item.querySelector('.request-close-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    area.hidden = true;
  });
}

export function renderRequests(requests) {
  const el = document.getElementById('requests-content');
  if (!el) return;

  const pending = requests.filter(r => r.status === 'pending');
  const badge = document.getElementById('requests-badge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.hidden = pending.length === 0;
  }

  if (requests.length === 0) {
    el.innerHTML = '<p class="requests-empty">No requests from agents yet.</p>';
    return;
  }

  const resolved = requests.filter(r => r.status !== 'pending');
  el.innerHTML = resolved.length > 0
    ? `<div class="requests-toolbar"><button class="requests-clear-btn" id="requests-clear-answered">Clear resolved (${resolved.length})</button></div>`
    : '';
  document.getElementById('requests-clear-answered')?.addEventListener('click', async () => {
    await act('/api/human-requests/answered', null);
  });

  for (const req of requests) {
    const item = document.createElement('div');
    item.className = `request-item request-item--${req.status}${req.urgency === 'high' && req.status === 'pending' ? ' request-item--high' : ''}`;
    item.dataset.id = req.id;

    const timeStr = new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgHtml = window.marked ? window.marked.parse(req.message) : esc(req.message);
    const ticketBadge = req.relatedTicketId
      ? `<span class="request-ticket-ref" title="Related ticket">${esc(req.relatedTicketId)}</span>`
      : '';

    item.innerHTML = `
      <div class="request-header">
        <span class="request-agent">${esc(req.agentName)}</span>
        ${statusBadge(req)}
        ${ticketBadge}
        <span class="request-time">${timeStr}</span>
      </div>
      <div class="request-message">${msgHtml}</div>
      ${req.status === 'pending' ? pendingBody() : resolvedBody(req)}`;

    if (req.status === 'pending') wirePending(item, req);
    el.appendChild(item);
  }
}
