// ── Human Requests panel ──────────────────────────────────────────────────────

import { esc } from './utils.js';

export function renderRequests(requests) {
  const el = document.getElementById('requests-content');
  if (!el) return;

  const pending = requests.filter(r => r.status === 'pending');
  const badge   = document.getElementById('requests-badge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.hidden = pending.length === 0;
  }

  if (requests.length === 0) {
    el.innerHTML = '<p class="requests-empty">No requests from agents yet.</p>';
    return;
  }

  const answered = requests.filter(r => r.status === 'answered');
  el.innerHTML = answered.length > 0
    ? `<div class="requests-toolbar"><button class="requests-clear-btn" id="requests-clear-answered">Clear answered (${answered.length})</button></div>`
    : '';
  document.getElementById('requests-clear-answered')?.addEventListener('click', async () => {
    await fetch('/api/human-requests/answered', { method: 'DELETE' });
  });

  for (const req of requests) {
    const item = document.createElement('div');
    item.className = `request-item request-item--${req.status}${req.urgency === 'high' ? ' request-item--high' : ''}`;
    item.dataset.id = req.id;

    const timeStr = new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgHtml = window.marked ? window.marked.parse(req.message) : esc(req.message);

    const ticketBadge = req.relatedTicketId
      ? `<span class="request-ticket-ref" title="Related ticket">${esc(req.relatedTicketId)}</span>`
      : '';

    const statusPart = req.status === 'answered'
      ? `<span class="request-done-badge">Answered</span>`
      : `<span class="request-urgency-badge request-urgency--${req.urgency}">${req.urgency === 'high' ? 'Urgent' : 'Low'}</span>`;

    const bodyPart = req.status === 'answered'
      ? `<div class="request-response-display">
           <span class="request-response-label">Your response</span>
           <div class="request-response-text">${esc(req.response ?? '')}</div>
         </div>`
      : `<div class="request-reply-area" hidden>
           <textarea class="request-reply-input" placeholder="Type your response…" rows="3"></textarea>
           <div class="request-reply-footer">
             <span class="request-reply-error"></span>
             <button class="request-cancel-btn">Cancel</button>
             <button class="request-reply-submit">Send Reply</button>
           </div>
         </div>`;

    item.innerHTML = `
      <div class="request-header">
        <span class="request-agent">${esc(req.agentName)}</span>
        ${statusPart}
        ${ticketBadge}
        <span class="request-time">${timeStr}</span>
      </div>
      <div class="request-message">${msgHtml}</div>
      ${bodyPart}`;

    if (req.status === 'pending') {
      item.addEventListener('click', (e) => {
        const area = item.querySelector('.request-reply-area');
        if (area.contains(e.target)) return;
        const open = area.hidden;
        area.hidden = !open;
        if (open) area.querySelector('textarea').focus();
      });

      item.querySelector('.request-reply-submit').addEventListener('click', async () => {
        const btn      = item.querySelector('.request-reply-submit');
        const textarea = item.querySelector('.request-reply-input');
        const errorEl  = item.querySelector('.request-reply-error');
        const response = textarea.value.trim();
        if (!response) { errorEl.textContent = 'Please enter a response.'; return; }
        btn.disabled = true; btn.textContent = '…'; errorEl.textContent = '';
        try {
          const r = await fetch(`/api/human-requests/${encodeURIComponent(req.id)}/respond`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response }),
          });
          const data = await r.json();
          if (!r.ok || data.error) { errorEl.textContent = data.error ?? 'Failed'; return; }
        } catch (err) {
          errorEl.textContent = err.message || 'Failed';
        } finally {
          btn.disabled = false; btn.textContent = 'Send Reply';
        }
      });

      item.querySelector('.request-cancel-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`/api/human-requests/${encodeURIComponent(req.id)}`, { method: 'DELETE' });
      });
    }

    el.appendChild(item);
  }
}
