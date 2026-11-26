// ── Specialisation helpers ────────────────────────────────────────────────────

export let specOptions = []; // populated from /api/specialisations on init

export async function loadSpecialisations() {
  try {
    const res = await fetch('/api/specialisations');
    const data = await res.json();
    specOptions = data.specialisations || [];
  } catch { specOptions = []; }
  populateSpecSelects();
}

export function populateSpecSelects() {
  for (const id of ['add-agent-specialisation']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const current = sel.value;
    sel.innerHTML = '<option value="">— none —</option>';
    for (const s of specOptions) {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    }
    const custom = document.createElement('option');
    custom.value = '__custom__'; custom.textContent = 'Custom…';
    sel.appendChild(custom);
    if (current) sel.value = current;
  }
}

export function getSpecValue(selectId, customId) {
  const sel = document.getElementById(selectId);
  if (!sel) return '';
  if (sel.value === '__custom__') return document.getElementById(customId)?.value.trim() || '';
  return sel.value;
}

export function setSpecValue(selectId, customId, value) {
  const sel  = document.getElementById(selectId);
  const cust = document.getElementById(customId);
  if (!sel) return;
  if (!value) {
    sel.value = '';
    if (cust) { cust.value = ''; cust.hidden = true; }
  } else if (specOptions.includes(value)) {
    sel.value = value;
    if (cust) { cust.value = ''; cust.hidden = true; }
  } else {
    sel.value = '__custom__';
    if (cust) { cust.value = value; cust.hidden = false; }
  }
}
