// ── SSE connection & state application ───────────────────────────────────────

import { state, syncAgentConfigs } from './state.js';
import { renderAgents } from './agents.js';
import { renderKanban, currentEditId, renderComments, initKanbanDrag, initTicketEditing } from './kanban.js';
import { updateGoalBar, updateProjectBadge } from './project.js';
import { renderRequests } from './requests.js';
import { renderAllowlist, initAllowlist } from './allowlist.js';
import { renderCalendar, fetchCalendar } from './calendar.js';
import { appendAgentFeedEvent, initAgentDetail } from './agent-detail.js';
import { appendCLIAgent, updateChatAgentSelect, initCLI } from './cli.js';
import { applyTelemetrySummary, telScope, refreshTelemetryBar } from './telemetry.js';
import { renderFilesList, fetchFiles, startFilesRefresh } from './files.js';
import { initTabs } from './panels.js';

// renderTools lives inline here because it's small and only used in SSE events.
function renderTools(tools) {
  const el = document.getElementById('tools-content');
  if (!el) return;

  let html = '';

  if (tools.builtin && tools.builtin.length > 0) {
    html += `<div class="tools-section-label">Built-in</div>`;
    for (const tool of tools.builtin) {
      const badges = (tool.agents ?? [])
        .map(a => `<span class="tool-agent-badge">${a}</span>`)
        .join('');
      html += `
        <div class="tool-row">
          <span class="tool-name">${tool.name}</span>
          <span class="tool-desc">${tool.description}</span>
          ${badges ? `<div class="tool-agents">${badges}</div>` : ''}
        </div>`;
    }
  }

  if (tools.mcp && tools.mcp.length > 0) {
    html += `<div class="tools-section-label" style="margin-top:6px">MCP Servers</div>`;
    for (const server of tools.mcp) {
      html += `
        <div class="tool-row">
          <div class="mcp-server-header">
            <span class="mcp-server-dot"></span>
            <span class="mcp-server-name">${server.server}</span>
            <span style="font-size:10px;color:var(--text-muted)">${server.tools.length} tools</span>
          </div>`;
      for (const tool of server.tools) {
        html += `
          <div style="padding:3px 0 3px 12px;border-top:1px solid var(--border)">
            <span class="tool-name" style="font-size:10px">${tool.name}</span>
            <span class="tool-desc" style="display:block">${tool.description}</span>
          </div>`;
      }
      html += `</div>`;
    }
  }

  if (!html) html = '<p class="tools-empty">No tools loaded yet</p>';
  el.innerHTML = html;
}

export function fetchTools() {
  fetch('/api/tools')
    .then(r => r.json())
    .then(tools => renderTools(tools))
    .catch(() => {});
}

// ── applyState ────────────────────────────────────────────────────────────────

export function applyState(newState) {
  Object.assign(state, newState); // mutate in place — preserves live bindings
  syncAgentConfigs();
  renderAgents(state.agents);
  renderKanban(state.tickets);
  updateChatAgentSelect();
}

// ── SSE connect ───────────────────────────────────────────────────────────────

let _sseInited = false;

export function connect() {
  const dot = document.getElementById('connection-status');
  const es  = new EventSource('/events');

  es.onopen = () => { dot.classList.add('connected'); dot.title = 'Connected'; };
  es.onerror = () => {
    dot.classList.remove('connected');
    dot.title = 'Disconnected — reconnecting…';
    es.close();
    setTimeout(connect, 3000);
  };

  es.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'init') {
      applyState({ agents: msg.agents, tickets: msg.tickets, humanName: msg.project?.humanName ?? 'human' });
      if (msg.project) updateProjectBadge(msg.project.id, msg.project.dir);
      updateGoalBar(msg.project?.goal, msg.tickets);
      fetchTools();
      fetchFiles();
      startFilesRefresh();
      fetchCalendar();
      fetch('/api/telemetry').then(r => r.json()).then(d => applyTelemetrySummary(d.summary)).catch(() => {});
      renderRequests(msg.requests ?? []);
      renderAllowlist(msg.allowlist ?? []);
      if (!_sseInited) {
        _sseInited = true;
        initTabs();
        initKanbanDrag();
        initTicketEditing();
        initCLI();
        initAgentDetail();
        initAllowlist();
      }
    } else if (msg.type === 'agent_update') {
      Object.assign(state, { agents: msg.agents });
      syncAgentConfigs();
      renderAgents(state.agents);
      updateChatAgentSelect();
    } else if (msg.type === 'scheduled_meetings_update') {
      renderCalendar(msg.meetings);
    } else if (msg.type === 'kanban_update') {
      state.tickets = msg.tickets;
      renderKanban(state.tickets);
      if (currentEditId) {
        const ticket = state.tickets.find(t => t.id === currentEditId);
        if (ticket) renderComments(ticket.comments ?? []);
      }
    } else if (msg.type === 'tools_update') {
      renderTools(msg.tools);
    } else if (msg.type === 'agent_stream') {
      appendAgentFeedEvent(msg.agent, msg.event);
    } else if (msg.type === 'cli_output') {
      appendCLIAgent(msg.from, msg.content, msg.kind);
    } else if (msg.type === 'telemetry_update') {
      if (telScope === 'project') applyTelemetrySummary(msg.summary);
      else refreshTelemetryBar();
    } else if (msg.type === 'requests_update') {
      renderRequests(msg.requests ?? []);
    } else if (msg.type === 'email_allowlist_update') {
      renderAllowlist(msg.allowlist ?? []);
    } else if (msg.type === 'files_update') {
      renderFilesList(msg.sources, msg.outputs, msg.tickets);
    } else if (msg.type === 'meeting_started') {
      const avatarMap = {}, voiceMap = {}, speakerMap = {}, backgroundMap = {}, hatMap = {};
      for (const a of state.agents) {
        if (a.avatar)      avatarMap[a.name]     = a.avatar;
        if (a.voice)       voiceMap[a.name]      = a.voice;
        if (a.speakerName) speakerMap[a.name]    = a.speakerName;
        if (a.background)  backgroundMap[a.name] = a.background;
        if (a.hatType)     hatMap[a.name]        = a.hatType;
      }
      window.meetingUI?.open(msg.meetingId, msg.topic, msg.participants ?? [], msg.facilitator ?? '', avatarMap, voiceMap, speakerMap, backgroundMap, state.humanName, hatMap);
    } else if (msg.type === 'meeting_turn') {
      window.meetingUI?.addTurn(msg.participant, msg.content);
    } else if (msg.type === 'meeting_human_turn') {
      window.meetingUI?.requestHumanTurn(msg.meetingId);
    } else if (msg.type === 'meeting_hand_raised') {
      window.meetingUI?.setHandRaised(msg.participant, msg.raised);
    } else if (msg.type === 'meeting_closed') {
      window.meetingUI?.close(msg.meetingId);
      fetchFiles();
    }
  };
}
