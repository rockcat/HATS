// ── Scheduled Actions tab ─────────────────────────────────────────────────────

import { esc } from './utils.js';

let _mcpToolSchemas = null;

// ── MCP tool schema cache ─────────────────────────────────────────────────────

export async function loadMcpToolSchemas() {
  if (_mcpToolSchemas) return _mcpToolSchemas;
  _mcpToolSchemas = await fetch('/api/mcp/tools').then(r => r.json()).catch(() => []);
  return _mcpToolSchemas;
}

export async function populateMcpServerSelect(sel) {
  sel.innerHTML = '<option value="">Loading…</option>';
  const schemas = await loadMcpToolSchemas();
  sel.innerHTML = '<option value="">Select a server…</option>';
  for (const entry of schemas) {
    const opt = document.createElement('option');
    opt.value = entry.agentName ? `${entry.server}||${entry.agentName}` : entry.server;
    opt.textContent = entry.agentName ? `${entry.server} (${entry.agentName})` : entry.server;
    sel.appendChild(opt);
  }
}

export function parseMcpServerValue(val) {
  const idx = val.indexOf('||');
  if (idx === -1) return { server: val, agentName: null };
  return { server: val.slice(0, idx), agentName: val.slice(idx + 2) };
}

export function populateMcpToolSelect(toolSel, serverSelectValue) {
  toolSel.innerHTML = '';
  toolSel.disabled  = !serverSelectValue;
  if (!serverSelectValue || !_mcpToolSchemas) {
    toolSel.innerHTML = '<option value="">Select server first</option>';
    return;
  }
  const { server, agentName } = parseMcpServerValue(serverSelectValue);
  const entry = _mcpToolSchemas.find(s => s.server === server && (s.agentName ?? null) === agentName);
  toolSel.innerHTML = '<option value="">Select a tool…</option>';
  if (!entry) return;
  for (const tool of entry.tools) {
    const opt = document.createElement('option');
    opt.value = tool.name;
    opt.textContent = tool.name.replace(`mcp__${server}__`, '');
    toolSel.appendChild(opt);
  }
}

export function buildMcpParamFields(container, toolName) {
  container.innerHTML = '';
  if (!toolName || !_mcpToolSchemas) return;
  const serverSelectValue = document.getElementById('schedules-mcp-server')?.value ?? '';
  const { server: serverName, agentName } = parseMcpServerValue(serverSelectValue);
  const serverEntry = _mcpToolSchemas.find(s => s.server === serverName && (s.agentName ?? null) === agentName);
  const tool = serverEntry?.tools.find(t => t.name === toolName);
  if (!tool) return;
  const props    = tool.parameters?.properties ?? {};
  const required = new Set(tool.parameters?.required ?? []);
  const keys     = Object.keys(props);
  if (!keys.length) {
    const note = document.createElement('div');
    note.className = 'schedules-mcp-hint';
    note.style.padding = '4px 0';
    note.textContent   = 'This tool takes no parameters.';
    container.appendChild(note);
    return;
  }
  for (const key of keys) {
    const schema = props[key];
    const row    = document.createElement('div');
    row.className = 'schedules-mcp-param-row';
    const lbl   = document.createElement('label');
    lbl.className  = 'schedules-mcp-label';
    lbl.textContent = key + (required.has(key) ? ' *' : '');
    if (schema.description) {
      const hint = document.createElement('span');
      hint.className  = 'schedules-mcp-hint';
      hint.textContent = ' — ' + schema.description;
      lbl.appendChild(hint);
    }
    let inp;
    if (schema.enum) {
      inp = document.createElement('select');
      inp.className = 'schedules-input';
      if (!required.has(key)) {
        const empty = document.createElement('option');
        empty.value = ''; empty.textContent = '— none —';
        inp.appendChild(empty);
      }
      for (const v of schema.enum) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        inp.appendChild(opt);
      }
    } else {
      inp = document.createElement('input');
      inp.type = (schema.type === 'number' || schema.type === 'integer') ? 'number' : 'text';
      inp.className   = 'schedules-input';
      inp.placeholder = schema.description ?? key;
      inp.autocomplete = 'off';
    }
    inp.dataset.paramKey  = key;
    inp.dataset.paramType = schema.type ?? 'string';
    row.appendChild(lbl);
    row.appendChild(inp);
    container.appendChild(row);
  }
}

export function collectMcpArgs(container) {
  const args = {};
  for (const inp of container.querySelectorAll('[data-param-key]')) {
    const val = inp.value;
    if (val === '') continue;
    const type    = inp.dataset.paramType;
    const coerced = (type === 'number' || type === 'integer') ? Number(val) : type === 'boolean' ? val === 'true' : val;
    if (coerced === false || (typeof coerced === 'number' && isNaN(coerced))) continue;
    args[inp.dataset.paramKey] = coerced;
  }
  return args;
}

// ── Schedule list rendering ───────────────────────────────────────────────────

export async function fetchScheduledActions() {
  try {
    const actions = await fetch('/api/scheduled-actions').then(r => r.json());
    renderScheduledActions(actions);
  } catch { /* ignore */ }
}

export function buildScheduleRow(action) {
  const intervalMins = action.intervalSeconds ? Math.round(action.intervalSeconds / 60) : null;
  const intervalText = intervalMins ? `Every ${intervalMins} min` : 'Once';

  const row = document.createElement('div');
  row.className = 'schedules-row';
  row.dataset.actionId = action.id;

  const isMcp    = action.type === 'mcp_tool_call';
  const descText = isMcp && action.mcpToolCall
    ? `${action.mcpToolCall.serverName}${action.mcpToolCall.personalMcpAgentName ? ` (${action.mcpToolCall.personalMcpAgentName})` : ''}: ${action.mcpToolCall.toolName.replace(/^mcp__[^_]+__/, '')} → ${action.mcpToolCall.condition || 'always notify'}`
    : action.description;

  const viewBody = document.createElement('div');
  viewBody.className = 'schedules-row-body';
  viewBody.title     = 'Click to edit';
  viewBody.innerHTML = `
    <div class="schedules-row-label">${esc(action.label)}${isMcp ? ' <span class="schedules-mcp-badge">MCP</span>' : ''}</div>
    <div class="schedules-row-desc">${esc(descText)}</div>`;

  const intervalBadge = document.createElement('span');
  intervalBadge.className   = 'schedules-row-interval';
  intervalBadge.textContent = intervalText;

  const delBtn  = document.createElement('button');
  delBtn.className  = 'library-btn library-btn--del';
  delBtn.title      = 'Delete';
  delBtn.textContent = '✕';

  const rowActions = document.createElement('div');
  rowActions.className = 'schedules-row-actions';
  rowActions.appendChild(delBtn);

  row.appendChild(viewBody);
  row.appendChild(intervalBadge);
  row.appendChild(rowActions);

  viewBody.addEventListener('click', () => openScheduleModal(action));
  delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this scheduled action?')) return;
    try {
      await fetch(`/api/scheduled-actions/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
      fetchScheduledActions();
    } catch { alert('Network error'); }
  });

  return row;
}

export function renderScheduledActions(actions) {
  const list = document.getElementById('schedules-list');
  if (!list) return;
  list.innerHTML = '';
  if (!actions.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px 12px;color:var(--text-muted);font-size:13px';
    empty.textContent   = 'No global scheduled actions yet. Add one below.';
    list.appendChild(empty);
    return;
  }
  for (const action of actions) list.appendChild(buildScheduleRow(action));
}

// ── Schedule modal ────────────────────────────────────────────────────────────

export function closeScheduleModal() {
  document.getElementById('schedule-modal').hidden = true;
}

export async function openScheduleModal(action) {
  const modal   = document.getElementById('schedule-modal');
  const titleEl = document.getElementById('schedule-modal-title');
  const saveBtn = document.getElementById('schedules-add-btn');

  document.getElementById('schedules-add-label').value       = '';
  document.getElementById('schedules-add-description').value = '';
  document.getElementById('schedules-add-interval').value    = '';
  document.getElementById('schedules-mcp-condition').value   = '';
  document.getElementById('schedules-mcp-message').value     = '';
  document.getElementById('schedules-mcp-params').innerHTML  = '';
  document.getElementById('schedules-mcp-test-result').hidden = true;
  document.querySelector('input[name="schedules-type"][value="prompt"]').checked = true;
  document.getElementById('schedules-prompt-fields').hidden = false;
  document.getElementById('schedules-mcp-fields').hidden    = true;
  const serverSel = document.getElementById('schedules-mcp-server');
  const toolSel   = document.getElementById('schedules-mcp-tool');
  serverSel.innerHTML = '<option value="">Select a server…</option>';
  toolSel.innerHTML   = '<option value="">Select server first</option>';
  toolSel.disabled    = true;

  if (action) {
    titleEl.textContent  = 'Edit Scheduled Action';
    saveBtn.textContent  = 'Save';
    modal.dataset.editId = action.id;
    document.getElementById('schedules-add-label').value = action.label;
    const intervalMins = action.intervalSeconds ? Math.round(action.intervalSeconds / 60) : '';
    document.getElementById('schedules-add-interval').value = String(intervalMins);

    if (action.type === 'mcp_tool_call' && action.mcpToolCall) {
      document.querySelector('input[name="schedules-type"][value="mcp_tool_call"]').checked = true;
      document.getElementById('schedules-prompt-fields').hidden = true;
      document.getElementById('schedules-mcp-fields').hidden    = false;
      document.getElementById('schedules-mcp-condition').value  = action.mcpToolCall.condition ?? '';
      document.getElementById('schedules-mcp-message').value    = action.mcpToolCall.messageTemplate ?? '';

      _mcpToolSchemas = null;
      await populateMcpServerSelect(serverSel);
      const mcp       = action.mcpToolCall;
      const targetVal = mcp.personalMcpAgentName
        ? `${mcp.serverName}||${mcp.personalMcpAgentName}`
        : mcp.serverName;
      serverSel.value = targetVal;
      populateMcpToolSelect(toolSel, serverSel.value);
      toolSel.value = mcp.toolName;
      buildMcpParamFields(document.getElementById('schedules-mcp-params'), mcp.toolName);
      for (const [key, val] of Object.entries(mcp.args ?? {})) {
        const inp = document.querySelector(`#schedules-mcp-params [data-param-key="${key}"]`);
        if (inp) inp.value = val;
      }
    } else {
      document.getElementById('schedules-add-description').value = action.description ?? '';
    }
  } else {
    titleEl.textContent  = 'New Scheduled Action';
    saveBtn.textContent  = 'Add';
    modal.dataset.editId = '';
  }

  modal.hidden = false;
}

// ── initSchedulesTab ──────────────────────────────────────────────────────────

export function initSchedulesTab() {
  document.getElementById('schedules-new-btn')?.addEventListener('click', () => openScheduleModal(null));
  document.getElementById('schedule-modal-close')?.addEventListener('click', closeScheduleModal);
  document.getElementById('schedule-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('schedule-modal')) closeScheduleModal();
  });

  document.querySelectorAll('input[name="schedules-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isMcp = document.querySelector('input[name="schedules-type"]:checked')?.value === 'mcp_tool_call';
      document.getElementById('schedules-prompt-fields').hidden = isMcp;
      document.getElementById('schedules-mcp-fields').hidden    = !isMcp;
      if (isMcp) {
        _mcpToolSchemas = null;
        populateMcpServerSelect(document.getElementById('schedules-mcp-server'));
      }
    });
  });

  document.getElementById('schedules-mcp-server')?.addEventListener('change', () => {
    const serverSelectValue = document.getElementById('schedules-mcp-server').value;
    populateMcpToolSelect(document.getElementById('schedules-mcp-tool'), serverSelectValue);
    document.getElementById('schedules-mcp-params').innerHTML = '';
  });

  document.getElementById('schedules-mcp-tool')?.addEventListener('change', () => {
    buildMcpParamFields(document.getElementById('schedules-mcp-params'), document.getElementById('schedules-mcp-tool').value);
    document.getElementById('schedules-mcp-test-result').hidden = true;
  });

  document.getElementById('schedules-mcp-test-btn')?.addEventListener('click', async () => {
    const serverSelectValue = document.getElementById('schedules-mcp-server')?.value ?? '';
    const toolName          = document.getElementById('schedules-mcp-tool')?.value ?? '';
    const resultEl          = document.getElementById('schedules-mcp-test-result');
    if (!serverSelectValue || !toolName) { alert('Please select a server and tool first'); return; }
    const { server: serverName, agentName } = parseMcpServerValue(serverSelectValue);
    const args = collectMcpArgs(document.getElementById('schedules-mcp-params'));
    resultEl.hidden    = false;
    resultEl.textContent = 'Running…';
    resultEl.className = 'schedules-mcp-test-result schedules-mcp-test-result--pending';
    try {
      const r = await fetch('/api/mcp/test-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, toolName, args, agentName: agentName || undefined }),
      });
      const data = await r.json();
      if (r.ok) {
        let display = data.result != null ? JSON.stringify(data.result, null, 2) : '(empty result)';
        const blocks    = Array.isArray(data.result?.content) ? data.result.content : [];
        const resultStr = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
          || JSON.stringify(data.result?.content ?? '');
        const condVal = document.getElementById('schedules-mcp-condition')?.value?.trim() ?? '';
        if (condVal) {
          let condLine;
          try {
            // eslint-disable-next-line no-new-func
            const passes = !!(new Function('result', `return !!(${condVal})`))(resultStr);
            condLine = `\n\n─ Condition: "${condVal}"\n  result string: ${JSON.stringify(resultStr.slice(0, 120))}${resultStr.length > 120 ? '…' : ''}\n  → ${passes ? '✓ TRUE — agent would be notified' : '✗ FALSE — agent would NOT be notified'}`;
          } catch (e) {
            condLine = `\n\n─ Condition: "${condVal}"\n  → Invalid JS: ${e.message}`;
          }
          display += condLine;
        }
        resultEl.textContent = display;
        resultEl.className   = 'schedules-mcp-test-result schedules-mcp-test-result--ok';
      } else {
        resultEl.textContent = `Error: ${data.error ?? 'Unknown error'}`;
        resultEl.className   = 'schedules-mcp-test-result schedules-mcp-test-result--error';
      }
    } catch (err) {
      resultEl.textContent = `Network error: ${err.message}`;
      resultEl.className   = 'schedules-mcp-test-result schedules-mcp-test-result--error';
    }
  });

  document.getElementById('schedules-add-btn')?.addEventListener('click', async () => {
    const modal    = document.getElementById('schedule-modal');
    const editId   = modal.dataset.editId ?? '';
    const type     = document.querySelector('input[name="schedules-type"]:checked')?.value ?? 'prompt';
    const label    = document.getElementById('schedules-add-label').value.trim();
    const intervalRaw     = document.getElementById('schedules-add-interval').value;
    const intervalMinutes = intervalRaw ? parseInt(intervalRaw, 10) : null;
    if (!label) { alert('Label is required'); return; }

    let body;
    if (type === 'mcp_tool_call') {
      const serverSelectValue = document.getElementById('schedules-mcp-server').value;
      const toolName          = document.getElementById('schedules-mcp-tool').value;
      const condition         = document.getElementById('schedules-mcp-condition').value.trim();
      const messageTemplate   = document.getElementById('schedules-mcp-message').value.trim();
      if (!serverSelectValue || !toolName) { alert('Please select a server and tool'); return; }
      if (!messageTemplate) { alert('Message template is required'); return; }
      const { server: serverName, agentName } = parseMcpServerValue(serverSelectValue);
      const args        = collectMcpArgs(document.getElementById('schedules-mcp-params'));
      const mcpToolCall = { serverName, toolName, args, condition, messageTemplate };
      if (agentName) mcpToolCall.personalMcpAgentName = agentName;
      body = { label, type: 'mcp_tool_call', mcpToolCall, intervalMinutes };
    } else {
      const description = document.getElementById('schedules-add-description').value.trim();
      if (!description) { alert('Description is required'); return; }
      body = { label, description, intervalMinutes };
    }

    const saveBtn = document.getElementById('schedules-add-btn');
    saveBtn.disabled = true; saveBtn.textContent = '…';
    try {
      const url    = editId ? `/api/scheduled-actions/${encodeURIComponent(editId)}` : '/api/scheduled-actions';
      const method = editId ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) {
        const e = await r.json();
        alert(e.error ?? 'Failed');
        saveBtn.disabled = false; saveBtn.textContent = editId ? 'Save' : 'Add';
        return;
      }
      closeScheduleModal();
      fetchScheduledActions();
    } catch {
      alert('Network error');
      saveBtn.disabled = false; saveBtn.textContent = editId ? 'Save' : 'Add';
    }
  });
}
