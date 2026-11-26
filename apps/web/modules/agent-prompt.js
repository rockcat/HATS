// ── An agent's prompt: extra instructions, and full or condensed ───────────────
//
// Both prompts are always built; the slider picks which one the agent is
// given. The condensed one is for small local models, where every token of
// context counts. The sizes beside the slider show what the choice saves.

import { esc } from './utils.js';

const MODES = ['full', 'condensed'];
let _name = null;
let _latest = null;
let _timer = null;

const el = id => document.getElementById(id);
const selectedMode = () => MODES[Number(el('agent-config-prompt-mode')?.value ?? 0)] ?? 'full';
const tokens = text => Math.round((text?.length ?? 0) / 4).toLocaleString();

function render() {
  const sizes = el('agent-prompt-sizes');
  const text  = el('agent-prompt-text');
  if (!_latest) { if (sizes) sizes.textContent = ''; return; }
  const mode = selectedMode();
  if (sizes) {
    sizes.innerHTML = MODES.map(m => {
      const n = tokens(m === 'full' ? _latest.prompt : _latest.condensed);
      return `<span class="${m === mode ? 'agent-prompt-size--on' : ''}">~${esc(n)}</span>`;
    }).join(' / ') + ' tokens';
  }
  if (text) text.textContent = (mode === 'full' ? _latest.prompt : _latest.condensed) ?? '';
}

async function refresh() {
  if (!_name) return;
  const name = _name;
  const params = new URLSearchParams({ instructions: el('agent-config-instructions')?.value ?? '' });
  try {
    const data = await fetch(`/api/agents/${encodeURIComponent(name)}/prompt-preview?${params}`).then(r => r.json());
    if (name !== _name) return; // another agent was opened meanwhile
    _latest = data.error ? null : data;
  } catch {
    _latest = null;
  }
  render();
}

/** Fill the prompt fields for this agent and show both prompt sizes. */
export function bindAgentPrompt(name, agent) {
  _name = name;
  _latest = null;
  const instructions = el('agent-config-instructions');
  const slider = el('agent-config-prompt-mode');
  if (!instructions || !slider) return;
  instructions.value = agent?.instructions ?? '';
  slider.value = String(Math.max(0, MODES.indexOf(agent?.promptMode ?? 'full')));
  render();
  refresh();
}

/** Wire the inputs once; called from initAgentDetail. */
export function initAgentPrompt() {
  el('agent-config-prompt-mode')?.addEventListener('input', render);
  el('agent-config-instructions')?.addEventListener('input', () => {
    clearTimeout(_timer);
    _timer = setTimeout(refresh, 400);
  });
}

/** Save what is in the fields; part of the Configure panel's Apply. */
export function saveAgentPrompt(name) {
  return fetch(`/api/agents/${encodeURIComponent(name)}/prompt`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instructions: el('agent-config-instructions')?.value ?? '',
      promptMode: selectedMode(),
    }),
  });
}
