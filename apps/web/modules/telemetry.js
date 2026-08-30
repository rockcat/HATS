// ── LLM Telemetry ─────────────────────────────────────────────────────────────

import { esc } from './utils.js';
import { fmtTokens } from './utils.js';

export const PIE_COLORS = [
  '#58a6ff','#3fb950','#e3b341','#f85149','#8957e5',
  '#39d353','#db6d28','#a5d6ff','#7ee787','#ffa657',
];

export let telScope = 'project'; // 'project' | 'all'

export function applyTelemetrySummary(summary) {
  if (!summary) return;
  document.getElementById('tel-in').textContent   = fmtTokens(summary.totalInputTokens  ?? 0);
  document.getElementById('tel-out').textContent  = fmtTokens(summary.totalOutputTokens ?? 0);
  document.getElementById('tel-cost').textContent = '$' + (summary.totalCost ?? 0).toFixed(4);
}

export function refreshTelemetryBar() {
  const url = telScope === 'all' ? '/api/telemetry/all' : '/api/telemetry';
  fetch(url).then(r => r.json()).then(d => { if (d.summary) applyTelemetrySummary(d.summary); }).catch(() => {});
}

export function initTelScopeToggle() {
  const btn = document.getElementById('tel-scope-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    telScope = telScope === 'project' ? 'all' : 'project';
    btn.textContent = telScope === 'all' ? 'All time' : 'Project';
    btn.classList.toggle('tel-scope-btn--all', telScope === 'all');
    refreshTelemetryBar();
  });
}

export function drawPie(canvas, data) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, r = Math.min(cx, cy) - 4;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    ctx.fillStyle = '#30363d';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    return;
  }
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
    ctx.fill();
    angle += slice;
  });
}

export function buildHourlyBuckets(records, days = 7) {
  const now    = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const buckets = new Map();
  for (const r of records) {
    const ts = new Date(r.ts).getTime();
    if (ts < cutoff) continue;
    const d = new Date(ts);
    d.setMinutes(0, 0, 0, 0);
    const key = d.getTime();
    if (!buckets.has(key)) buckets.set(key, {});
    const b = buckets.get(key);
    if (!b[r.agent]) b[r.agent] = { cost: 0, calls: 0 };
    b[r.agent].cost += r.cost;
    b[r.agent].calls++;
  }
  const startD = new Date(cutoff);
  startD.setMinutes(0, 0, 0, 0);
  const slots = [];
  for (let ms = startD.getTime(); ms <= now + 3_600_000; ms += 3_600_000) {
    slots.push({ hour: new Date(ms), data: buckets.get(ms) ?? {} });
  }
  return slots;
}

export function renderHourlyChart(records) {
  const canvas  = document.getElementById('tel-hourly-canvas');
  const tooltip = document.getElementById('tel-hourly-tooltip');
  if (!canvas) return;

  const BAR_W = 8, BAR_GAP = 2, SLOT_W = BAR_W + BAR_GAP;
  const AXIS_LEFT = 44, AXIS_BOTTOM = 24, TOP_PAD = 8, CHART_H = 120;
  const slots = buildHourlyBuckets(records ?? [], 7);

  canvas.width  = AXIS_LEFT + slots.length * SLOT_W;
  canvas.height = TOP_PAD + CHART_H + AXIS_BOTTOM;

  const agentSet = new Set();
  for (const s of slots) Object.keys(s.data).forEach(a => agentSet.add(a));
  const agents     = [...agentSet].sort();
  const agentColor = Object.fromEntries(agents.map((a, i) => [a, PIE_COLORS[i % PIE_COLORS.length]]));

  let maxCost = 0;
  for (const s of slots) {
    const total = Object.values(s.data).reduce((n, d) => n + d.cost, 0);
    if (total > maxCost) maxCost = total;
  }
  if (!maxCost) maxCost = 0.001;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const TICK_COUNT = 4;
  for (let t = 0; t <= TICK_COUNT; t++) {
    const frac  = t / TICK_COUNT;
    const y     = TOP_PAD + CHART_H - frac * CHART_H;
    const val   = maxCost * frac;
    const label = val >= 0.01 ? '$' + val.toFixed(2) : val > 0 ? '$' + val.toFixed(4) : '$0';
    ctx.fillStyle = '#6e7681';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(label, AXIS_LEFT - 4, y + 3);
    ctx.strokeStyle = t === 0 ? '#30363d' : '#21262d';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(AXIS_LEFT, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  for (let i = 0; i < slots.length; i++) {
    const x = AXIS_LEFT + i * SLOT_W;
    let yBottom = TOP_PAD + CHART_H;
    for (const agent of agents) {
      const entry = slots[i].data[agent];
      if (!entry) continue;
      const h = Math.max(1, (entry.cost / maxCost) * CHART_H);
      ctx.fillStyle = agentColor[agent];
      ctx.fillRect(x, yBottom - h, BAR_W, h);
      yBottom -= h;
    }
  }

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  ctx.fillStyle = '#6e7681';
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < slots.length; i += 24) {
    const d       = slots[i].hour;
    const label   = DAY_NAMES[d.getDay()] + ' ' + d.getDate();
    const xCenter = AXIS_LEFT + i * SLOT_W + 12 * SLOT_W;
    ctx.fillText(label, xCenter, TOP_PAD + CHART_H + 16);
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(AXIS_LEFT + i * SLOT_W, TOP_PAD + CHART_H);
    ctx.lineTo(AXIS_LEFT + i * SLOT_W, TOP_PAD + CHART_H + 5);
    ctx.stroke();
  }

  const legendEl = document.getElementById('tel-hourly-legend');
  if (legendEl) {
    legendEl.innerHTML = agents.map(a =>
      `<div class="tel-legend-item"><span class="tel-legend-dot" style="background:${agentColor[a]}"></span><span class="tel-legend-label">${esc(a)}</span></div>`
    ).join('');
  }

  const wrap = canvas.closest('.tel-hourly-scroll');
  canvas.onmousemove = (e) => {
    if (!tooltip) return;
    const rect    = canvas.getBoundingClientRect();
    const slotIdx = Math.floor((e.clientX - rect.left - AXIS_LEFT) / SLOT_W);
    if (slotIdx < 0 || slotIdx >= slots.length) { tooltip.hidden = true; return; }
    const slot  = slots[slotIdx];
    const total = Object.values(slot.data).reduce((n, d) => n + d.cost, 0);
    if (!total) { tooltip.hidden = true; return; }
    const timeStr = slot.hour.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit' });
    const rows    = agents.filter(a => slot.data[a]).map(a =>
      `<div class="tel-tip-row"><span class="tel-tip-dot" style="background:${agentColor[a]}"></span><span>${esc(a)}</span><span>$${slot.data[a].cost.toFixed(4)}</span></div>`
    ).join('');
    tooltip.innerHTML = `<div class="tel-tip-time">${timeStr}</div>${rows}<div class="tel-tip-total">$${total.toFixed(4)}</div>`;
    tooltip.hidden    = false;
    tooltip.style.left = Math.min(e.clientX + 14, window.innerWidth - 180) + 'px';
    tooltip.style.top  = (e.clientY - 60) + 'px';
  };
  canvas.onmouseleave = () => { if (tooltip) tooltip.hidden = true; };

  requestAnimationFrame(() => { if (wrap) wrap.scrollLeft = wrap.scrollWidth; });
}

export function renderTelemetryModal(data) {
  const { summary } = data;
  if (!summary) return;

  document.getElementById('tel-total-calls').textContent = summary.totalCalls ?? 0;
  document.getElementById('tel-total-in').textContent    = fmtTokens(summary.totalInputTokens  ?? 0);
  document.getElementById('tel-total-out').textContent   = fmtTokens(summary.totalOutputTokens ?? 0);
  document.getElementById('tel-total-cost').textContent  = '$' + (summary.totalCost ?? 0).toFixed(4);

  const byModel = Object.entries(summary.byModel ?? {}).map(([k, v]) => ({ label: k, value: v.cost }));
  drawPie(document.getElementById('tel-chart-model'), byModel);
  renderLegend('tel-legend-model', byModel, summary.totalCost);

  const byAgent = Object.entries(summary.byAgent ?? {}).map(([k, v]) => ({ label: k, value: v.cost }));
  drawPie(document.getElementById('tel-chart-agent'), byAgent);
  renderLegend('tel-legend-agent', byAgent, summary.totalCost);

  renderHourlyChart(data.records ?? []);

  const tbody = document.getElementById('tel-table-body');
  tbody.innerHTML = '';
  for (const [model, m] of Object.entries(summary.byModel ?? {})) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(model)}</td>
      <td>${m.calls}</td>
      <td>${fmtTokens(m.inputTokens)}</td>
      <td>${fmtTokens(m.outputTokens)}</td>
      <td>$${m.cost.toFixed(4)}</td>
    `;
    tbody.appendChild(tr);
  }
}

export function renderLegend(elId, data, total) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = data.map((d, i) => {
    const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) + '%' : '—';
    return `<div class="tel-legend-item">
      <span class="tel-legend-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
      <span class="tel-legend-label">${esc(d.label)}</span>
      <span class="tel-legend-pct">${pct}</span>
    </div>`;
  }).join('');
}

export function initTelemetry() {
  const btn   = document.getElementById('telemetry-btn');
  const modal = document.getElementById('telemetry-modal');
  const close = document.getElementById('telemetry-close');

  btn.addEventListener('click', async () => {
    modal.hidden = false;
    try {
      const data = await fetch('/api/telemetry').then(r => r.json());
      renderTelemetryModal(data);
    } catch { /* ignore */ }
  });

  close.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
}
