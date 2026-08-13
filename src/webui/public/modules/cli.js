// ── CLI tab ───────────────────────────────────────────────────────────────────

import { state } from './state.js';

let cliInited      = false;
let cliReplyTarget = null;

export function setCliReply(agentName) {
  cliReplyTarget = agentName;
  const bar   = document.getElementById('cli-reply-bar');
  const label = document.getElementById('cli-reply-label');
  if (!bar || !label) return;
  if (agentName) {
    label.textContent = `Replying to ${agentName}`;
    bar.hidden = false;
  } else {
    bar.hidden = true;
    label.textContent = '';
  }
  const input = document.getElementById('cli-input');
  if (input) {
    if (agentName && !input.value.startsWith(`@${agentName} `)) {
      input.value = `@${agentName} `;
    }
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

export function initCLI() {
  if (cliInited) return;
  cliInited = true;

  const input = document.getElementById('cli-input');
  if (!input) return;

  document.getElementById('cli-reply-cancel')?.addEventListener('click', () => {
    setCliReply(null);
    input.value = '';
    input.focus();
  });

  document.getElementById('chat-agent-select')?.addEventListener('change', updateChatThreads);
  updateChatAgentSelect();

  // ── @ mention menu ────────────────────────────────────────────────────────────

  let menuEl  = null;
  let menuIdx = 0;
  let atStart = -1;

  const agentNames = () => (state.agents ?? []).map(a => a.name);

  const filtered = () => {
    if (atStart < 0) return [];
    const fragment = input.value.slice(atStart + 1).toLowerCase();
    return agentNames().filter(n => n.toLowerCase().startsWith(fragment));
  };

  const closeMenu = () => {
    menuEl?.remove();
    menuEl  = null;
    atStart = -1;
    menuIdx = 0;
  };

  const renderMenu = () => {
    const items = filtered();
    if (!items.length) { closeMenu(); return; }

    if (!menuEl) {
      menuEl = document.createElement('div');
      menuEl.className = 'at-mention-menu';
      document.getElementById('cli-input-row').appendChild(menuEl);
    }

    const fragment = atStart >= 0 ? input.value.slice(atStart) : '@';
    menuEl.innerHTML = `<div class="at-mention-hint">@${fragment.slice(1) || '…'}  ↑↓ navigate · Enter select · Esc cancel</div>`;

    items.forEach((name, i) => {
      const el = document.createElement('div');
      el.className = 'at-mention-item' + (i === menuIdx ? ' selected' : '');
      el.innerHTML = `<span class="at-mention-arrow">▶</span><span>${name}</span>`;
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        selectItem(name);
      });
      menuEl.appendChild(el);
    });
  };

  const selectItem = (name) => {
    if (atStart < 0) return;
    const before = input.value.slice(0, atStart);
    input.value  = before + '@' + name + ' ';
    closeMenu();
    input.focus();
  };

  input.addEventListener('input', () => {
    const val    = input.value;
    const cursor = input.selectionStart ?? val.length;
    const segment = val.slice(0, cursor);
    const idx     = segment.lastIndexOf('@');

    if (idx >= 0 && !segment.slice(idx + 1).includes(' ')) {
      atStart = idx;
      menuIdx = 0;
      renderMenu();
    } else {
      closeMenu();
    }
  });

  input.addEventListener('keydown', e => {
    if (menuEl) {
      const items = filtered();
      if (e.key === 'ArrowDown')  { e.preventDefault(); menuIdx = Math.min(menuIdx + 1, items.length - 1); renderMenu(); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); menuIdx = Math.max(menuIdx - 1, 0); renderMenu(); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && items[menuIdx]) { e.preventDefault(); selectItem(items[menuIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    }

    if (e.key === 'Enter' && !menuEl) {
      const line = input.value.trim();
      if (!line) return;
      input.value = '';
      setCliReply(null);
      appendCLILine('> ' + line, 'cli-input-echo');

      fetch('/api/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
      })
        .then(r => r.json())
        .then(data => { if (data.output) appendCLILine(data.output, 'cli-response'); })
        .catch(err => appendCLILine('Error: ' + err, 'cli-error'));
    }
  });

  document.addEventListener('click', e => {
    if (menuEl && !menuEl.contains(e.target) && e.target !== input) closeMenu();
  });
}

export function updateChatAgentSelect() {
  const sel = document.getElementById('chat-agent-select');
  if (!sel) return;
  const prev   = sel.value;
  const agents = state.agents ?? [];
  sel.innerHTML = '<option value="">— select agent —</option>';
  for (const a of agents) {
    const opt = document.createElement('option');
    opt.value = a.name;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  if (prev && sel.querySelector(`option[value="${CSS.escape(prev)}"]`)) {
    sel.value = prev;
  } else if (agents.length) {
    sel.value = agents[0].name;
  }
  updateChatThreads();
}

export function updateChatThreads() {
  const sel = document.getElementById('chat-agent-select');
  const el  = document.getElementById('chat-threads');
  if (!sel || !el) return;
  const name = sel.value;
  if (name) el.setAttribute('agent', name);
  else el.removeAttribute('agent');
}

export function appendCLILine(text, cls) {
  const out = document.getElementById('cli-output');
  if (!out) return;
  const el = document.createElement('div');
  el.className = 'cli-line ' + (cls || '');
  el.textContent = text;
  out.appendChild(el);
  out.scrollTop = out.scrollHeight;
}

export function appendCLIAgent(from) {
  const sel = document.getElementById('chat-agent-select');
  if (sel && from && sel.value !== from) {
    const opt = sel.querySelector(`option[value="${CSS.escape(from)}"]`);
    if (opt) { sel.value = from; updateChatThreads(); }
  }
  document.getElementById('chat-threads')?._refresh();
}
