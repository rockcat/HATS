// ── Agent detail drawer ───────────────────────────────────────────────────────

import { esc, mdSafe, truncate } from './utils.js';
import { hat, hatLabel } from './hat.js';
import { state, agentConfigs } from './state.js';
import { getVoices, findVoiceForAgent, getSpeakerOverrides, setVoiceOverride, getVoiceOverrides } from './voice.js';
import { setSpeechAgent, clearSpeechQueue, setActiveSpeechTarget, ensureAudioCtx } from './voice.js';
import { getAvatars, findAvatarForAgent, applyAvatarBackground, getAvatarOverrides } from './avatars.js';
import { refreshProviderModels } from './providers.js';

export let activeDetailAgent = null;
let activeChatAgent          = null;
let agentDetailInited        = false;

export let toolCallDetail = localStorage.getItem('toolCallDetail') ?? 'simple';
export const setToolCallDetail = (val) => { toolCallDetail = val; };

// ── FEED_META ────────────────────────────────────────────────────────────────

const FEED_META = {
  task_assigned:  { icon: '📋', cls: 'task',      label: 'Task assigned'  },
  task_complete:  { icon: '✓',  cls: 'complete',  label: 'Task complete'  },
  tool_call:      { icon: '<img src="assets/settings.svg" class="svg-icon svg-icon--feed" alt="">', cls: 'tool', label: 'Tool call' },
  tool_result:    { icon: '↩',  cls: 'result',    label: 'Tool result'    },
  tool_error:     { icon: '✗',  cls: 'error',     label: 'Tool error'     },
  agent_response: { icon: '💬', cls: 'response',  label: 'Response'       },
  direct_message: { icon: '→',  cls: 'message',   label: 'Message'        },
  escalation:     { icon: '⚠',  cls: 'escalation',label: 'Escalation'     },
  human_message:  { icon: '👤', cls: 'human',     label: 'Human message'  },
  human_reply:    { icon: '👤', cls: 'human',     label: 'Human reply'    },
};

// ── Feed helpers ──────────────────────────────────────────────────────────────

export function loadAgentFeedInto(name, feedEl) {
  feedEl.innerHTML = '<p class="feed-empty">Loading…</p>';
  fetch(`/api/agents/${encodeURIComponent(name)}/feed`)
    .then(r => r.json())
    .then(events => {
      feedEl.innerHTML = '';
      if (!events.length) { feedEl.innerHTML = '<p class="feed-empty">No activity yet.</p>'; return; }
      for (const ev of events) {
        const el = buildFeedItem(ev, name);
        if (el) feedEl.appendChild(el);
      }
      feedEl.scrollTop = feedEl.scrollHeight;
    })
    .catch(() => { feedEl.innerHTML = '<p class="feed-empty">Failed to load.</p>'; });
}

export function buildFeedItem(ev, selfName) {
  if (ev.type === 'tool_result' && toolCallDetail !== 'detailed') return null;
  const el   = document.createElement('div');
  const meta = FEED_META[ev.type] || { icon: '·', cls: 'feed-default', label: ev.type };
  el.className = 'feed-item feed-' + meta.cls;

  const d     = new Date(ev.ts || Date.now());
  const time  = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const label = feedLabel(ev, selfName, meta.label);
  const body  = feedBody(ev);

  el.innerHTML = `
    <div class="feed-item-header">
      <span class="feed-icon">${meta.icon}</span>
      <span class="feed-label">${esc(label)}</span>
      <span class="feed-time">${esc(time)}</span>
    </div>
    ${body ? `<div class="feed-body">${body}</div>` : ''}`;
  return el;
}

function feedLabel(ev, selfName, defaultLabel) {
  if (ev.type === 'direct_message') return ev.from === selfName ? `→ ${ev.to}` : `← ${ev.from}`;
  if (ev.type === 'task_assigned')  return ev.from === selfName ? `Delegated to ${ev.to}` : `Task from ${ev.from}`;
  if (ev.type === 'tool_call')      return `Tool called: ${ev.tool}`;
  return defaultLabel;
}

function feedBody(ev) {
  switch (ev.type) {
    case 'task_assigned':  return mdSafe(ev.task || ev.description || '');
    case 'task_complete':  return mdSafe(ev.summary || '');
    case 'tool_call': {
      if (toolCallDetail !== 'detailed') return '';
      const args = ev.args ? JSON.stringify(ev.args, null, 2) : '';
      return args ? `<pre class="feed-pre">${esc(truncate(args, 300))}</pre>` : '';
    }
    case 'tool_result':
      if (toolCallDetail !== 'detailed') return '';
      return `<pre class="feed-pre">${esc(truncate(String(ev.result ?? ''), 400))}</pre>`;
    case 'tool_error':     return `<span class="feed-err">${esc(ev.error || '')}</span>`;
    case 'agent_response': return mdSafe(ev.content || '');
    case 'direct_message': return mdSafe(ev.content || '');
    case 'escalation':     return mdSafe(ev.message || '');
    case 'human_message':
    case 'human_reply':    return mdSafe(ev.content || '');
    default:               return '';
  }
}

// ── Personal MCP ──────────────────────────────────────────────────────────────

import { parseFeatureOverrides, serializeFeatureOverrides } from './mcp.js';

export function buildPersonalMcpEntry(agentName, entry) {
  const wrap = document.createElement('div');
  wrap.className = 'personal-mcp-entry';
  wrap.dataset.serverId = entry.id;

  const header = document.createElement('div');
  header.className = 'personal-mcp-header';

  const title = document.createElement('span');
  title.className  = 'personal-mcp-title';
  title.textContent = entry.name;
  header.appendChild(title);

  if (entry.description) {
    const desc = document.createElement('span');
    desc.className  = 'personal-mcp-desc';
    desc.textContent = entry.description;
    header.appendChild(desc);
  }
  if (entry.url) {
    const link = document.createElement('a');
    link.className = 'mcp-entry-link';
    link.href = entry.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.title = 'Setup docs ↗'; link.textContent = 'docs ↗';
    header.appendChild(link);
  }
  wrap.appendChild(header);

  const fields = document.createElement('div');
  fields.className = 'personal-mcp-fields';
  const inputs = {};

  for (const varDef of (entry.envVars ?? [])) {
    const varName = typeof varDef === 'string' ? varDef : varDef.name;

    if (varDef.type === 'features' && varDef.features?.length) {
      const section = document.createElement('div');
      section.className = 'personal-mcp-features-section';
      const sectionLbl = document.createElement('div');
      sectionLbl.className  = 'personal-mcp-field-label';
      sectionLbl.textContent = 'Features';
      section.appendChild(sectionLbl);
      const existing = parseFeatureOverrides(entry.credentials?.[varName] ?? '');
      const grid = document.createElement('div');
      grid.className = 'personal-mcp-features-grid';
      const checksMap = {};
      for (const feat of varDef.features) {
        const isOn = feat.key in existing ? existing[feat.key] : feat.defaultOn;
        const item = document.createElement('label');
        item.className = 'personal-mcp-feature-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = isOn;
        item.appendChild(cb);
        item.appendChild(document.createTextNode(' ' + feat.label));
        grid.appendChild(item);
        checksMap[feat.key] = { cb, defaultOn: feat.defaultOn };
      }
      section.appendChild(grid);
      fields.appendChild(section);
      inputs[varName] = { getValue: () => serializeFeatureOverrides(checksMap) };
    } else {
      const varHint = typeof varDef === 'string' ? varName : (varDef.placeholder ?? varName);
      const row = document.createElement('div');
      row.className = 'personal-mcp-field-row';
      const lbl = document.createElement('label');
      lbl.className  = 'personal-mcp-field-label';
      lbl.textContent = varName;
      const inp = document.createElement('input');
      inp.type = varName.toLowerCase().includes('password') || varName.toLowerCase().includes('secret') ? 'password' : 'text';
      inp.className   = 'personal-mcp-field-input';
      inp.value       = entry.credentials?.[varName] ?? '';
      inp.placeholder = varHint;
      inp.autocomplete = 'off';
      row.appendChild(lbl); row.appendChild(inp);
      fields.appendChild(row);
      inputs[varName] = { getValue: () => inp.value.trim() };
    }
  }
  wrap.appendChild(fields);

  const actions  = document.createElement('div');
  actions.className = 'personal-mcp-actions';

  const saveBtn   = document.createElement('button');
  saveBtn.className  = 'personal-mcp-save-btn';
  saveBtn.textContent = entry.active ? 'Update' : 'Enable';
  saveBtn.onclick = async () => {
    const credentials = {};
    for (const [k, inp] of Object.entries(inputs)) credentials[k] = inp.getValue();
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/personal-mcp/${encodeURIComponent(entry.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentials }),
      });
      if (!res.ok) throw new Error(await res.text());
      saveBtn.textContent = 'Saved!';
      entry.active = true;
      disableBtn.hidden = false;
      setTimeout(() => { saveBtn.textContent = 'Update'; saveBtn.disabled = false; }, 1500);
    } catch (err) {
      saveBtn.textContent = 'Error'; saveBtn.title = err.message;
      setTimeout(() => { saveBtn.textContent = entry.active ? 'Update' : 'Enable'; saveBtn.disabled = false; }, 2000);
    }
  };
  actions.appendChild(saveBtn);

  const disableBtn   = document.createElement('button');
  disableBtn.className  = 'personal-mcp-disable-btn';
  disableBtn.textContent = 'Disable';
  disableBtn.hidden      = !entry.active;
  disableBtn.onclick = async () => {
    disableBtn.disabled = true; disableBtn.textContent = 'Disabling…';
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/personal-mcp/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      entry.active = false; disableBtn.hidden = true; saveBtn.textContent = 'Enable'; disableBtn.disabled = false;
    } catch (err) {
      disableBtn.textContent = 'Error'; disableBtn.title = err.message;
      setTimeout(() => { disableBtn.textContent = 'Disable'; disableBtn.disabled = false; }, 2000);
    }
  };
  actions.appendChild(disableBtn);
  wrap.appendChild(actions);
  return wrap;
}

// ── Prompt preview ────────────────────────────────────────────────────────────

export async function refreshPromptPreview() {
  if (!activeDetailAgent) return;
  const textEl = document.getElementById('agent-prompt-preview-text');
  const agent  = state.agents.find(a => a.name === activeDetailAgent);
  const hats   = agent?.hatType ?? ['white'];
  const name   = (document.getElementById('agent-detail-name').value.trim()) || activeDetailAgent;
  const spec   = agent?.specialisation ?? '';
  textEl.textContent = 'Loading…';
  try {
    const params = new URLSearchParams({ name });
    for (const h of hats) params.append('hat', h);
    if (spec) params.set('specialisation', spec);
    const res  = await fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/prompt-preview?${params}`);
    const data = await res.json();
    textEl.textContent = data.prompt ?? data.error ?? 'Error';
    const promptLength = data.prompt ? data.prompt.length : 0;
    const numTokens    = Math.round(promptLength / 4);
    const toolsChars   = data.toolsChars ?? 0;
    const toolTokens   = Math.round(toolsChars / 4);
    const toolNote     = toolsChars ? `  +~${toolTokens.toLocaleString()} tool tokens` : '';
    document.getElementById('agent-prompt-preview-length').textContent =
      `~${numTokens.toLocaleString()} prompt tokens (${promptLength.toLocaleString()} chars)${toolNote}`;
  } catch {
    textEl.textContent = 'Failed to load prompt.';
  }
}

export function togglePromptPreview() { /* agent-prompt-preview removed from HTML */ }

// ── initAgentDetail ───────────────────────────────────────────────────────────

export function initAgentDetail() {
  if (agentDetailInited) return;
  agentDetailInited = true;

  document.getElementById('agents-container').addEventListener('click', e => {
    if (e.target.closest('.agent-card-chat-btn')) {
      const card = e.target.closest('.agent-card');
      if (card) openAgentChat(card.dataset.name);
      return;
    }
    const card = e.target.closest('.agent-card');
    if (card) openAgentDetail(card.dataset.name);
  });
  document.getElementById('agent-detail-close').addEventListener('click', closeAgentDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && activeDetailAgent) closeAgentDetail();
  });
  document.getElementById('agent-detail-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('agent-detail-modal')) closeAgentDetail();
  });

  const nameInput = document.getElementById('agent-detail-name');
  const commitRename = async () => {
    if (!activeDetailAgent) return;
    const newName = nameInput.value.trim();
    if (!newName || newName === activeDetailAgent) return;
    const res = await fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/name`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    }).then(r => r.json());
    if (res.error) { nameInput.value = activeDetailAgent; alert(res.error); return; }
    const voiceO  = getVoiceOverrides();  if (voiceO[activeDetailAgent])  { voiceO[newName]  = voiceO[activeDetailAgent];  delete voiceO[activeDetailAgent];  localStorage.setItem('agentVoices',  JSON.stringify(voiceO)); }
    const avatarO = getAvatarOverrides(); if (avatarO[activeDetailAgent]) { avatarO[newName] = avatarO[activeDetailAgent]; delete avatarO[activeDetailAgent]; localStorage.setItem('agentAvatars', JSON.stringify(avatarO)); }
    activeDetailAgent = newName;
  };
  nameInput.addEventListener('blur', commitRename);
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); nameInput.blur(); }
    if (e.key === 'Escape') { nameInput.value = activeDetailAgent; nameInput.blur(); }
  });

  document.getElementById('agent-detail-configure-btn').addEventListener('click', () => {
    document.getElementById('agent-detail').classList.remove('chat-mode');
    activeChatAgent = null;
  });

  document.getElementById('agent-remove-btn').addEventListener('click', () => {
    if (!activeDetailAgent) return;
    if (!confirm(`Remove agent "${activeDetailAgent}"? Their in-progress tickets will be returned to the backlog.`)) return;
    fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(res => { if (res.error) { alert(res.error); return; } closeAgentDetail(); });
  });

  document.getElementById('agent-config-apply').addEventListener('click', async () => {
    if (!activeDetailAgent) return;
    const btn = document.getElementById('agent-config-apply');
    btn.textContent = '…'; btn.disabled = true;
    try {
      const tasks = [];
      const email = document.getElementById('agent-config-email').value.trim() || undefined;
      tasks.push(fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/email`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }));
      const mcpLine = document.getElementById('agent-config-mcp-line');
      if (mcpLine && !mcpLine.hidden) {
        const checks     = Array.from(document.querySelectorAll('#agent-config-mcp-list input[type="checkbox"]'));
        const allChecked = checks.every(c => c.checked);
        const servers    = allChecked ? null : checks.filter(c => c.checked).map(c => c.value);
        tasks.push(fetch(`/api/agents/${encodeURIComponent(activeDetailAgent)}/mcp-servers`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servers }),
        }));
      }
      await Promise.all(tasks);
      btn.textContent = '✓';
    } catch { btn.textContent = '✗'; }
    setTimeout(() => { btn.textContent = 'Apply'; btn.disabled = false; }, 1500);
  });
}

// ── openAgentDetail ───────────────────────────────────────────────────────────

export function openAgentDetail(name, chatOnly = false) {
  activeDetailAgent = name;
  activeChatAgent   = chatOnly ? name : null;
  document.getElementById('agent-detail').classList.toggle('chat-mode', chatOnly);
  refreshProviderModels();

  const agent = state.agents.find(a => a.name === name);
  const c     = agent ? hat(agent.hatType) : hat('white');

  const nameInput = document.getElementById('agent-detail-name');
  nameInput.value = name;
  document.getElementById('agent-detail-hat').textContent = agent ? hatLabel(agent.hatType) : '';
  document.getElementById('agent-detail-hat').style.color = c.bar;
  document.getElementById('agent-config-email').value = agent?.email || '';

  const ticketsEl     = document.getElementById('agent-detail-tickets');
  ticketsEl.innerHTML = '';
  const agentTickets  = (state.tickets ?? []).filter(t => t.assignee === name && t.column !== 'closed');
  for (const t of agentTickets) {
    const chip = document.createElement('span');
    chip.className   = 'agent-ticket-chip';
    chip.title       = t.title;
    chip.textContent = `${t.id} ${t.title}`;
    ticketsEl.appendChild(chip);
  }

  document.getElementById('agent-detail-modal').hidden = false;

  const threadsEl = document.getElementById('agent-detail-threads');
  if (threadsEl) threadsEl.setAttribute('agent', name);

  ensureAudioCtx();
  setActiveSpeechTarget(name);

  getVoices().then(voices => {
    const current     = findVoiceForAgent(name, voices);
    const speakerName = getSpeakerOverrides()[name] ?? null;
    setSpeechAgent(name, current, speakerName);
  });

  getAvatars().then(avatars => {
    const current = findAvatarForAgent(name);
    if (current && window.avatarAPI) {
      const bgFile = agentConfigs.get(name)?.background ?? null;
      window.avatarAPI.show(current.file, current.camera, current.rotate, current.fov, current.scale, bgFile);
    } else if (window.avatarAPI) {
      window.avatarAPI.hide();
    }
  });
  applyAvatarBackground(agentConfigs.get(name)?.background ?? null);

  fetch('/api/mcp/catalogue')
    .then(r => r.json())
    .then(catalogue => {
      const enabledServers = catalogue.filter(e => e.enabled);
      const mcpLine = document.getElementById('agent-config-mcp-line');
      const mcpList = document.getElementById('agent-config-mcp-list');
      if (enabledServers.length === 0) { mcpLine.hidden = true; return; }
      mcpLine.hidden = false;
      const agentServers = agent?.enabledMcpServers;
      mcpList.innerHTML  = '';
      for (const entry of enabledServers) {
        const checked = !agentServers || agentServers.includes(entry.id);
        const lbl = document.createElement('label');
        lbl.className = 'agent-config-mcp-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = entry.id; cb.checked = checked;
        lbl.appendChild(cb); lbl.append(' ' + entry.name);
        mcpList.appendChild(lbl);
      }
    })
    .catch(() => { document.getElementById('agent-config-mcp-line').hidden = true; });

  fetch(`/api/agents/${encodeURIComponent(name)}/personal-mcp`)
    .then(r => r.json())
    .then(entries => {
      const line = document.getElementById('agent-config-personal-mcp-line');
      const list = document.getElementById('agent-config-personal-mcp-list');
      if (!entries.length) { line.hidden = true; return; }
      line.hidden = false;
      list.innerHTML = '';
      for (const entry of entries) list.appendChild(buildPersonalMcpEntry(name, entry));
    })
    .catch(() => { document.getElementById('agent-config-personal-mcp-line').hidden = true; });
}

export function closeAgentDetail() {
  clearSpeechQueue(activeDetailAgent);
  setSpeechAgent(null);
  setActiveSpeechTarget(null);
  activeDetailAgent = null;
  activeChatAgent   = null;
  document.getElementById('agent-detail').classList.remove('chat-mode');
  document.getElementById('agent-detail-modal').hidden = true;
  document.getElementById('agent-detail-threads')?.removeAttribute('agent');
  applyAvatarBackground(null);
  if (window.avatarAPI) window.avatarAPI.hide();
}

export function appendAgentFeedEvent(agentName) {
  if (activeDetailAgent !== agentName) return;
  document.getElementById('agent-detail-threads')?._refresh();
}

// ── Agent chat (thin wrapper) ─────────────────────────────────────────────────

export function openAgentChat(name) {
  openAgentDetail(name, true);
}

export function closeAgentChat() {
  closeAgentDetail();
}
