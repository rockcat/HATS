// ── Hat helpers ───────────────────────────────────────────────────────────────

import { HAT, HAT_OPTIONS, HAT_DESC } from './constants.js';

export function hatLabel(type) {
  const types = Array.isArray(type) ? type : [type];
  const real = types.filter(t => t && t !== 'none');
  if (real.length === 0) return 'No Hat';
  if (real.length === 1) {
    const desc = HAT_DESC[real[0]];
    return desc ? `${real[0]} hat — ${desc}` : `${real[0]} hat`;
  }
  return real.map(t => t + ' hat').join(' + ');
}

export function hat(type) {
  const types = Array.isArray(type) ? type : [type ?? 'none'];
  const real = types.filter(t => t && t !== 'none');
  if (real.length === 0) return HAT.none;
  if (real.length === 1) return HAT[real[0]] ?? HAT.white;
  const bars = real.map(t => HAT[t]?.bar ?? '#888');
  return {
    bar: `linear-gradient(135deg, ${bars.join(', ')})`,
    label: HAT[real[0]]?.label ?? HAT.white.label,
    bg: HAT[real[0]]?.bg ?? HAT.white.bg,
  };
}

export function populateHatGroup(containerId, selectedHats) {
  const group = document.getElementById(containerId);
  if (!group) return;
  const selected = new Set(Array.isArray(selectedHats) ? selectedHats : [selectedHats ?? 'none']);
  group.innerHTML = '';
  for (const h of HAT_OPTIONS) {
    const lbl = document.createElement('label');
    lbl.className = 'hat-check-item';
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.value = h.value;
    inp.checked = selected.has(h.value);
    const dot = document.createElement('span');
    dot.className = 'hat-check-dot';
    dot.style.background = HAT[h.value]?.bar ?? '#888';
    const txt = document.createElement('span');
    txt.className = 'hat-check-label';
    txt.textContent = h.label;
    lbl.append(inp, dot, txt);
    lbl.classList.toggle('hat-check-item--on', inp.checked);
    inp.addEventListener('change', () => lbl.classList.toggle('hat-check-item--on', inp.checked));
    group.appendChild(lbl);
  }
}

export function getSelectedHats(containerId) {
  const checks = document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`);
  const vals = Array.from(checks).map(c => c.value);
  return vals.length ? vals : ['none'];
}
