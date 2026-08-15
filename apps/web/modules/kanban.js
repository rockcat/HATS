// ── Kanban rendering, drag-drop and ticket editing ────────────────────────────

import { esc } from './utils.js';
import { state } from './state.js';

// Injected at init time to avoid circular dep with project.js.
let _updateGoalBar = () => {};

export function initKanban({ updateGoalBar }) {
  _updateGoalBar = updateGoalBar;

  // Filter change listeners — need state, so placed here rather than top-level.
  document.getElementById('kanban-filter-user')?.addEventListener('change', e => {
    kanbanFilterUser = e.target.value;
    renderKanban(state.tickets);
  });
  document.getElementById('kanban-filter-tag')?.addEventListener('change', e => {
    kanbanFilterTag = e.target.value;
    renderKanban(state.tickets);
  });
}

const PRIORITY_COLOR = {
  critical: '#f85149',
  high:     '#e3b341',
  medium:   '#58a6ff',
  low:      '#8b949e',
};

const ACTIVE_COLUMNS = ['ready', 'in_progress', 'blocked', 'review', 'closed'];

let kanbanFilterUser = '';
let kanbanFilterTag  = '';

function populateKanbanFilters(tickets) {
  const users = [...new Set(tickets.map(t => t.assignee).filter(Boolean))].sort();
  const tags  = [...new Set(tickets.flatMap(t => t.tags ?? []))].sort();

  const userSel = document.getElementById('kanban-filter-user');
  const tagSel  = document.getElementById('kanban-filter-tag');
  if (!userSel || !tagSel) return;

  const prevUser = userSel.value;
  const prevTag  = tagSel.value;

  userSel.innerHTML = '<option value="">All users</option>' +
    users.map(u => `<option value="${esc(u)}"${u === prevUser ? ' selected' : ''}>${esc(u)}</option>`).join('');
  tagSel.innerHTML = '<option value="">All tags</option>' +
    tags.map(t => `<option value="${esc(t)}"${t === prevTag ? ' selected' : ''}>${esc(t)}</option>`).join('');

  if (users.includes(prevUser)) userSel.value = prevUser;
  if (tags.includes(prevTag))   tagSel.value  = prevTag;
}

function applyKanbanFilters(tickets) {
  return tickets.filter(t => {
    if (kanbanFilterUser && t.assignee !== kanbanFilterUser) return false;
    if (kanbanFilterTag  && !(t.tags ?? []).includes(kanbanFilterTag)) return false;
    return true;
  });
}

export function renderKanban(tickets) {
  _updateGoalBar(document.getElementById('goal-text')?.textContent, tickets);
  populateKanbanFilters(tickets);
  const visible = applyKanbanFilters(tickets);

  for (const colId of ACTIVE_COLUMNS) {
    const colEl = document.getElementById(`col-${colId}`);
    if (!colEl) continue;
    const colTickets = visible.filter(t => t.column === colId);
    colEl.querySelector('.kanban-col-count').textContent = colTickets.length || '';
    const list = colEl.querySelector('.task-list');
    list.innerHTML = colTickets.length
      ? colTickets.map(ticketHTML).join('')
      : '<p class="empty-hint">No tickets</p>';
  }

  const backlog = visible.filter(t => t.column === 'backlog');
  const countEl = document.getElementById('backlog-count');
  if (countEl) countEl.textContent = backlog.length || '';
  const listEl = document.getElementById('backlog-list');
  if (listEl) {
    listEl.innerHTML = backlog.length
      ? backlog.map(backlogRowHTML).join('')
      : '<p class="backlog-empty">No tickets in backlog</p>';
  }
}

function isHumanTicket(ticket) {
  const name = (state.humanName ?? 'human').toLowerCase();
  return (ticket.assignee ?? '').toLowerCase() === name;
}

function ticketHTML(ticket) {
  const priority    = ticket.priority ?? 'medium';
  const priColor    = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title       = ticket.title ?? ticket.description?.slice(0, 60) ?? ticket.id;
  const assignee    = ticket.assignee ?? '—';
  const tags        = (ticket.tags ?? []).slice(0, 3);
  const projectName = ticket.projectName ?? '';
  const blockers    = ticket.blockedBy ?? [];
  const human       = isHumanTicket(ticket);

  const tagsHTML = tags.map(t => `<span class="ticket-tag">${esc(t)}</span>`).join('');
  const projectHTML = projectName
    ? `<div class="ticket-project" title="${esc(ticket.projectFolder ?? '')}">📁 ${esc(projectName)}</div>`
    : '';
  const blockersHTML = blockers.length
    ? `<div class="ticket-blockers" title="Blocked by: ${esc(blockers.join(', '))}">⛔ ${esc(blockers.join(', '))}</div>`
    : '';

  return `
    <div class="task-card${blockers.length ? ' task-card--blocked' : ''}${human ? ' task-card--human' : ''}" data-ticket-id="${esc(ticket.id)}" draggable="true" title="Drag to move · Click to edit">
      <div class="ticket-top">
        <span class="ticket-id">${esc(ticket.id)}</span>
        <span class="priority-badge" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
      </div>
      <div class="ticket-title">${esc(title)}</div>
      ${projectHTML}
      ${blockersHTML}
      <div class="task-footer">
        <span class="task-assignee">${esc(assignee)}</span>
        ${tagsHTML}
      </div>
    </div>`;
}

function backlogRowHTML(ticket) {
  const priority    = ticket.priority ?? 'medium';
  const priColor    = PRIORITY_COLOR[priority] ?? PRIORITY_COLOR.medium;
  const title       = ticket.title ?? ticket.description?.slice(0, 80) ?? ticket.id;
  const assignee    = ticket.assignee ?? '—';
  const tags        = (ticket.tags ?? []).slice(0, 2)
    .map(t => `<span class="ticket-tag">${esc(t)}</span>`).join('');
  const projectName = ticket.projectName ?? '';
  const human       = isHumanTicket(ticket);

  return `
    <div class="backlog-row${human ? ' backlog-row--human' : ''}" data-ticket-id="${esc(ticket.id)}" draggable="true" title="Drag to move · Click to edit">
      <span class="backlog-id">${esc(ticket.id)}</span>
      <span class="backlog-title">${esc(title)}</span>
      <span class="backlog-project">${projectName ? `📁 ${esc(projectName)}` : ''}</span>
      <span class="backlog-assignee">${esc(assignee)}</span>
      <span class="backlog-tags">${tags}</span>
      <span class="backlog-priority" style="color:${priColor};border-color:${priColor}40">${esc(priority)}</span>
    </div>`;
}

// ── Kanban drag & drop ────────────────────────────────────────────────────────

let draggedTicketId = null;
let kanbanDragInited = false;

export function initKanbanDrag() {
  if (kanbanDragInited) return;
  kanbanDragInited = true;

  const active  = document.getElementById('kanban-active');
  const backlog = document.getElementById('backlog-list');

  [active, backlog].forEach(container => {
    container.addEventListener('dragstart', e => {
      const card = e.target.closest('[data-ticket-id]');
      if (!card) return;
      draggedTicketId = card.dataset.ticketId;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedTicketId);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    container.addEventListener('dragend', e => {
      const card = e.target.closest('[data-ticket-id]');
      if (card) card.classList.remove('dragging');
      document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
      draggedTicketId = null;
    });
  });

  const dropZones = [...document.querySelectorAll('#kanban-active .task-list'), backlog];

  dropZones.forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!draggedTicketId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drop-target');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-target');
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drop-target');
      if (!draggedTicketId) return;

      const col    = zone.closest('.kanban-col');
      const column = col ? col.id.replace('col-', '') : 'backlog';

      const ticket = state.tickets.find(t => t.id === draggedTicketId);
      if (!ticket || ticket.column === column) return;

      ticket.column = column;
      if (column === 'closed') ticket.closedReason = ticket.closedReason ?? 'completed';
      else delete ticket.closedReason;
      renderKanban(state.tickets);

      const dragBody = { column };
      if (column === 'closed') dragBody.closedReason = ticket.closedReason;
      fetch(`/api/kanban/tickets/${encodeURIComponent(draggedTicketId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dragBody),
      })
        .then(r => r.json())
        .then(result => { if (result.error) console.warn('Drag failed:', result.error); })
        .catch(err => console.warn('Drag error:', err));
    });
  });
}

// ── Ticket edit modal ─────────────────────────────────────────────────────────

export let currentEditId = null;
let ticketEditingInited = false;

export function initTicketEditing() {
  if (ticketEditingInited) return;
  ticketEditingInited = true;

  document.getElementById('kanban-active').addEventListener('click', e => {
    const card = e.target.closest('[data-ticket-id]');
    if (card) openTicketModal(card.dataset.ticketId);
  });
  document.getElementById('backlog-list').addEventListener('click', e => {
    const row = e.target.closest('[data-ticket-id]');
    if (row) openTicketModal(row.dataset.ticketId);
  });

  document.getElementById('new-ticket-btn').addEventListener('click', openNewTicketModal);
  document.getElementById('board-refresh-btn').addEventListener('click', () => {
    fetch('/api/kanban/tickets')
      .then(r => r.json())
      .then(({ tickets }) => { state.tickets = tickets ?? []; renderKanban(state.tickets); })
      .catch(() => {});
  });
  document.getElementById('modal-close').addEventListener('click', closeTicketModal);
  document.getElementById('modal-cancel').addEventListener('click', closeTicketModal);
  document.getElementById('modal-save').addEventListener('click', saveTicket);
  document.getElementById('modal-comment-submit').addEventListener('click', postComment);
  document.getElementById('edit-column').addEventListener('change', e => {
    document.getElementById('edit-closed-reason-group').style.display =
      e.target.value === 'closed' ? '' : 'none';
  });
  document.getElementById('modal-comment-text').addEventListener('keydown', e => {
    if (e.key === 'Enter') postComment();
  });
  document.getElementById('ticket-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeTicketModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('ticket-modal').hidden) closeTicketModal();
  });
}

function populateAssigneeDropdown(selected) {
  const sel = document.getElementById('edit-assignee');
  const names = ['', ...(state.agents ?? []).map(a => a.name), 'human'];
  if (selected && !names.includes(selected)) names.push(selected);
  sel.innerHTML = names.map(n =>
    `<option value="${esc(n)}"${n === selected ? ' selected' : ''}>${n ? esc(n) : '— unassigned —'}</option>`
  ).join('');
}

function openNewTicketModal() {
  document.getElementById('modal-ticket-id').textContent = 'New Ticket';
  document.getElementById('edit-title').value       = '';
  document.getElementById('edit-description').value = '';
  document.getElementById('edit-priority').value    = 'medium';
  document.getElementById('edit-column').value      = 'backlog';
  document.getElementById('edit-closed-reason-group').style.display = 'none';
  populateAssigneeDropdown('');
  document.getElementById('edit-tags').value        = '';
  document.getElementById('edit-blocked-by').value  = '';
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-save').textContent = 'Create ticket';
  document.getElementById('modal-activity-section').hidden = true;
  currentEditId = null;
  document.getElementById('ticket-modal').hidden = false;
  document.getElementById('edit-title').focus();
}

function openTicketModal(id) {
  const ticket = state.tickets.find(t => t.id === id);
  if (!ticket) return;

  document.getElementById('modal-ticket-id').textContent = id;
  document.getElementById('edit-title').value       = ticket.title ?? '';
  document.getElementById('edit-description').value = ticket.description ?? '';
  document.getElementById('edit-priority').value    = ticket.priority ?? 'medium';
  const col = ticket.column ?? 'backlog';
  document.getElementById('edit-column').value      = col;
  document.getElementById('edit-closed-reason-group').style.display = col === 'closed' ? '' : 'none';
  if (col === 'closed') {
    document.getElementById('edit-closed-reason').value = ticket.closedReason ?? 'completed';
  }
  populateAssigneeDropdown(ticket.assignee ?? '');
  document.getElementById('edit-tags').value        = (ticket.tags ?? []).join(', ');
  document.getElementById('edit-blocked-by').value  = (ticket.blockedBy ?? []).join(', ');
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-save').textContent = 'Save changes';
  document.getElementById('modal-activity-section').hidden = false;
  renderComments(ticket.comments ?? []);
  document.getElementById('modal-comment-text').value = '';

  currentEditId = id;
  document.getElementById('ticket-modal').hidden = false;
  document.getElementById('edit-title').focus();
}

export function renderComments(comments) {
  const el = document.getElementById('modal-comments');
  if (!el) return;
  if (!comments.length) {
    el.innerHTML = '<p class="comments-empty">No activity yet.</p>';
    return;
  }
  el.innerHTML = comments.map(c => {
    const d = new Date(c.ts);
    const when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="comment">
        <div class="comment-header">
          <span class="comment-author">${esc(c.author)}</span>
          <span class="comment-ts">${esc(when)}</span>
        </div>
        <div class="comment-text">${esc(c.text)}</div>
      </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function closeTicketModal() {
  document.getElementById('ticket-modal').hidden = true;
  currentEditId = null;
}

function saveTicket() {
  const saveBtn = document.getElementById('modal-save');
  saveBtn.disabled = true;
  const originalLabel = saveBtn.textContent;
  saveBtn.textContent = 'Saving…';

  const editColumn = document.getElementById('edit-column').value;
  const body = {
    title:        document.getElementById('edit-title').value.trim(),
    description:  document.getElementById('edit-description').value.trim(),
    priority:     document.getElementById('edit-priority').value,
    column:       editColumn,
    closedReason: editColumn === 'closed'
      ? document.getElementById('edit-closed-reason').value
      : undefined,
    assignee:     document.getElementById('edit-assignee').value.trim() || null,
    tags:         document.getElementById('edit-tags').value
      .split(',').map(t => t.trim()).filter(Boolean),
    blockedBy:    document.getElementById('edit-blocked-by').value
      .split(',').map(t => t.trim().toUpperCase()).filter(Boolean),
  };

  const isCreate = currentEditId === null;
  const url    = isCreate ? '/api/kanban/tickets' : `/api/kanban/tickets/${encodeURIComponent(currentEditId)}`;
  const method = isCreate ? 'POST' : 'PATCH';

  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => {
      const text = await r.text();
      let result;
      try { result = JSON.parse(text); } catch { result = { error: text || `HTTP ${r.status}` }; }
      if (!r.ok || result.error) {
        document.getElementById('modal-error').textContent = result.error ?? `HTTP ${r.status}`;
      } else {
        closeTicketModal();
      }
    })
    .catch(err => { document.getElementById('modal-error').textContent = String(err); })
    .finally(() => { saveBtn.disabled = false; saveBtn.textContent = originalLabel; });
}

function postComment() {
  if (!currentEditId) return;
  const input = document.getElementById('modal-comment-text');
  const text  = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('modal-comment-submit');
  btn.disabled = true;

  fetch(`/api/kanban/tickets/${encodeURIComponent(currentEditId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: 'human', text }),
  })
    .then(r => r.json())
    .then(result => {
      if (!result.error) {
        input.value = '';
        const ticket = state.tickets.find(t => t.id === currentEditId);
        if (ticket) {
          ticket.comments = [...(ticket.comments ?? []), result];
          renderComments(ticket.comments);
        }
      }
    })
    .catch(() => {})
    .finally(() => { btn.disabled = false; });
}
