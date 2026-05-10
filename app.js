import { addReading, deleteReading, clearAll, getAllReadings } from './db.js';
import { renderChart } from './chart.js';

const $ = id => document.getElementById(id);

const els = {
  glucose: $('glucose'),
  calcBtn: $('calc'),
  result: $('result'),
  resultUnits: $('result-units'),
  resultFormula: $('result-formula'),
  note: $('note'),
  saveBtn: $('save'),
  discardBtn: $('discard'),
  chart: $('chart'),
  chartSummary: $('chart-summary'),
  history: $('history'),
  historyCount: $('history-count'),
  historyEmpty: $('history-empty'),
  lastReading: $('last-reading'),
  exportBtn: $('export'),
  clearBtn: $('clear-all'),
  toast: $('toast'),
};

let pending = null;

function calculateInsulin(mmol) {
  const mgdl = mmol * 18;
  const insulin = mgdl > 100 ? (mgdl - 80) / 40 : mgdl / 40;
  return { mgdl, insulin, branch: mgdl > 100 ? 'hi' : 'lo' };
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function onCalc() {
  const v = parseFloat(els.glucose.value);
  if (!Number.isFinite(v) || v <= 0) {
    showToast('Enter a glucose value');
    return;
  }
  const { mgdl, insulin, branch } = calculateInsulin(v);
  pending = {
    id: crypto.randomUUID(),
    glucose_mmol: v,
    glucose_mgdl: Math.round(mgdl * 10) / 10,
    insulin: Math.round(insulin * 10) / 10,
    timestamp: Date.now(),
    note: '',
  };
  els.resultUnits.textContent = pending.insulin.toFixed(1);
  els.resultFormula.textContent = branch === 'hi'
    ? `${v} × 18 = ${mgdl.toFixed(0)} mg/dL → (${mgdl.toFixed(0)} − 80) ÷ 40`
    : `${v} × 18 = ${mgdl.toFixed(0)} mg/dL → ${mgdl.toFixed(0)} ÷ 40`;
  els.result.classList.remove('hidden');
  els.note.value = '';
  els.note.focus({ preventScroll: true });
}

function discardPending() {
  pending = null;
  els.result.classList.add('hidden');
  els.glucose.value = '';
  els.glucose.focus();
}

async function onSave() {
  if (!pending) return;
  pending.note = els.note.value.trim();
  pending.timestamp = Date.now();
  try {
    await addReading(pending);
    showToast('Saved');
    discardPending();
    await refresh();
  } catch (err) {
    showToast('Save failed');
    console.error(err);
  }
}

async function onDelete(id) {
  if (!confirm('Delete this reading?')) return;
  await deleteReading(id);
  await refresh();
}

async function onClearAll() {
  if (!confirm('Delete ALL readings? This cannot be undone.')) return;
  await clearAll();
  await refresh();
  showToast('All readings cleared');
}

async function onExport() {
  const all = await getAllReadings();
  if (all.length === 0) {
    showToast('Nothing to export');
    return;
  }
  const header = 'id,timestamp_iso,timestamp_ms,glucose_mmol,glucose_mgdl,insulin_units,note\n';
  const rows = all.map(r => [
    r.id,
    new Date(r.timestamp).toISOString(),
    r.timestamp,
    r.glucose_mmol,
    r.glucose_mgdl,
    r.insulin,
    JSON.stringify(r.note || ''),
  ].join(','));
  const csv = header + rows.join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `sweet-t-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderHistory(readings) {
  els.history.innerHTML = '';
  els.historyCount.textContent = readings.length === 0 ? '' : `${readings.length} reading${readings.length === 1 ? '' : 's'}`;
  els.historyEmpty.classList.toggle('hidden', readings.length > 0);

  for (const r of readings) {
    const li = document.createElement('li');
    const cls = r.glucose_mmol > 7.8 ? 'hi' : r.glucose_mmol < 4.0 ? 'lo' : '';
    li.innerHTML = `
      <div>
        <div class="glucose ${cls}">${r.glucose_mmol.toFixed(1)} <span class="muted small">mmol/L</span></div>
        <div class="when">${formatTime(r.timestamp)}</div>
      </div>
      <div class="insulin">${r.insulin.toFixed(1)}u</div>
      <button class="row-del" data-id="${r.id}" aria-label="Delete">×</button>
      ${r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ''}
    `;
    els.history.appendChild(li);
  }
  els.history.querySelectorAll('button.row-del').forEach(btn => {
    btn.addEventListener('click', () => onDelete(btn.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLastReadingBadge(readings) {
  if (readings.length === 0) {
    els.lastReading.textContent = '';
    return;
  }
  const r = readings[0];
  els.lastReading.textContent = `${r.glucose_mmol.toFixed(1)} · ${formatTime(r.timestamp)}`;
}

function renderChartSummary(readings) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = readings.filter(r => r.timestamp >= since);
  if (recent.length === 0) { els.chartSummary.textContent = ''; return; }
  const avg = recent.reduce((s, r) => s + r.glucose_mmol, 0) / recent.length;
  els.chartSummary.textContent = `${recent.length} readings · avg ${avg.toFixed(1)}`;
}

async function refresh() {
  const readings = await getAllReadings();
  renderHistory(readings);
  renderLastReadingBadge(readings);
  renderChart(els.chart, readings);
  renderChartSummary(readings);
}

function bind() {
  els.calcBtn.addEventListener('click', onCalc);
  els.glucose.addEventListener('keydown', e => { if (e.key === 'Enter') onCalc(); });
  els.note.addEventListener('keydown', e => { if (e.key === 'Enter') onSave(); });
  els.saveBtn.addEventListener('click', onSave);
  els.discardBtn.addEventListener('click', discardPending);
  els.exportBtn.addEventListener('click', onExport);
  els.clearBtn.addEventListener('click', onClearAll);
}

async function init() {
  bind();
  await refresh();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
