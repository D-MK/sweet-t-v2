import {
  addReading,
  deleteReading,
  clearAll,
  getAllReadings,
  getReadingById,
  updateReading,
  importReadings,
} from "./db.js";
import { renderChart } from "./chart.js";
import {
  getSyncSettings,
  saveSyncSettings,
  enqueue,
  drainOutbox,
  getOutboxCount,
} from "./sync.js";

const $ = (id) => document.getElementById(id);

const els = {
  glucose: $("glucose"),
  calcBtn: $("calc"),
  result: $("result"),
  resultUnits: $("result-units"),
  resultFormula: $("result-formula"),
  note: $("note"),
  timestampToggle: $("timestamp-toggle"),
  timestampInput: $("timestamp-input"),
  saveBtn: $("save"),
  discardBtn: $("discard"),
  chart: $("chart"),
  chartSummary: $("chart-summary"),
  history: $("history"),
  historyCount: $("history-count"),
  historyEmpty: $("history-empty"),
  lastReading: $("last-reading"),
  exportBtn: $("export"),
  importBtn: $("import"),
  importInput: $("import-input"),
  importModal: $("import-modal"),
  importPreview: $("import-preview"),
  importConfirmBtn: $("import-confirm"),
  importCancelBtn: $("import-cancel"),
  clearBtn: $("clear-all"),
  toast: $("toast"),
  settingsOpenBtn: $("settings-open"),
  settingsOverlay: $("settings-overlay"),
  settingsCloseBtn: $("settings-close"),
  settingsSaveBtn: $("settings-save"),
  settingsCancelBtn: $("settings-cancel"),
  syncEnabled: $("sync-enabled"),
  syncUrl: $("sync-url"),
  syncToken: $("sync-token"),
  syncToggleError: $("sync-toggle-error"),
  syncPending: $("sync-pending"),
};

let pending = null;

function calculateInsulin(mmol) {
  const mgdl = mmol * 18;
  const insulin = mgdl > 100 ? (mgdl - 80) / 40 : mgdl / 40;
  return { mgdl, insulin, branch: mgdl > 100 ? "hi" : "lo" };
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function toDatetimeLocal(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromDatetimeLocal(str) {
  return new Date(str).getTime();
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function onCalc() {
  const v = parseFloat(els.glucose.value);
  if (!Number.isFinite(v) || v <= 0) {
    showToast("Enter a glucose value");
    return;
  }
  const { mgdl, insulin, branch } = calculateInsulin(v);
  pending = {
    id: crypto.randomUUID(),
    glucose_mmol: v,
    glucose_mgdl: Math.round(mgdl * 10) / 10,
    insulin: Math.round(insulin * 10) / 10,
    timestamp: Date.now(),
    note: "",
  };
  els.resultUnits.textContent = pending.insulin.toFixed(1);
  els.resultFormula.textContent =
    branch === "hi"
      ? `${v} × 18 = ${mgdl.toFixed(0)} mg/dL → (${mgdl.toFixed(0)} − 80) ÷ 40`
      : `${v} × 18 = ${mgdl.toFixed(0)} mg/dL → ${mgdl.toFixed(0)} ÷ 40`;
  els.result.classList.remove("hidden");
  els.timestampToggle.checked = false;
  els.timestampInput.hidden = true;
  els.timestampInput.value = toDatetimeLocal(pending.timestamp);
  els.note.value = "";
  els.note.focus({ preventScroll: true });
}

function discardPending() {
  pending = null;
  els.result.classList.add("hidden");
  els.glucose.value = "";
  els.glucose.focus();
}

async function onSave() {
  if (!pending) return;
  pending.note = els.note.value.trim();
  if (els.timestampToggle.checked) {
    pending.timestamp = fromDatetimeLocal(els.timestampInput.value);
  } else {
    pending.timestamp = Date.now();
  }
  try {
    await addReading(pending);
    const settings = getSyncSettings();
    if (settings.enabled) {
      enqueue(pending);
      drainOutbox();
    }
    showToast("Saved");
    discardPending();
    await refresh();
  } catch (err) {
    showToast("Save failed");
    console.error(err);
  }
}

async function onDelete(id) {
  if (!confirm("Delete this reading?")) return;
  await deleteReading(id);
  await refresh();
}

let editingId = null;

async function onEditStart(id) {
  const reading = await getReadingById(id);
  if (!reading) return;
  editingId = id;
  await refresh();
}

function onEditCancel() {
  editingId = null;
  refresh();
}

async function onEditSave(id) {
  const li = els.history.querySelector(`li[data-id="${id}"]`);
  if (!li) return;
  const glucoseInput = li.querySelector('[data-field="glucose"]');
  const timestampInput = li.querySelector('[data-field="timestamp"]');
  const noteInput = li.querySelector('[data-field="note"]');

  const glucose = parseFloat(glucoseInput.value);
  if (!Number.isFinite(glucose) || glucose <= 0) {
    showToast("Invalid glucose value");
    return;
  }

  const timestamp = new Date(timestampInput.value).getTime();
  const note = noteInput.value.trim();

  // Check for timestamp conflicts
  const all = await getAllReadings();
  const conflict = all.find((r) => r.id !== id && r.timestamp === timestamp);
  if (conflict) {
    showToast("Timestamp already exists, skipping");
    return;
  }

  const { mgdl, insulin } = calculateInsulin(glucose);
  try {
    await updateReading(id, {
      glucose_mmol: glucose,
      glucose_mgdl: Math.round(mgdl * 10) / 10,
      insulin: Math.round(insulin * 10) / 10,
      timestamp,
      note,
    });
    showToast("Updated");
    editingId = null;
    await refresh();
  } catch (err) {
    showToast("Update failed");
    console.error(err);
  }
}

async function onClearAll() {
  if (!confirm("Delete ALL readings? This cannot be undone.")) return;
  await clearAll();
  await refresh();
  showToast("All readings cleared");
}

async function onExport() {
  const all = await getAllReadings();
  if (all.length === 0) {
    showToast("Nothing to export");
    return;
  }
  const header =
    "id,timestamp_iso,timestamp_ms,glucose_mmol,glucose_mgdl,insulin_units,note\n";
  const rows = all.map((r) =>
    [
      r.id,
      new Date(r.timestamp).toISOString(),
      r.timestamp,
      r.glucose_mmol,
      r.glucose_mgdl,
      r.insulin,
      JSON.stringify(r.note || ""),
    ].join(","),
  );
  const csv = header + rows.join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `sweet-t-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    showToast("CSV is empty");
    return [];
  }

  const header = lines[0].split(",").map((h) => h.trim());
  const readings = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = line.split(",");
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx] ? cells[idx].trim() : "";
    });

    const reading = {
      id: obj.id || crypto.randomUUID(),
      glucose_mmol: parseFloat(obj.glucose_mmol),
      glucose_mgdl: parseFloat(obj.glucose_mgdl),
      insulin: parseFloat(obj.insulin_units),
      timestamp:
        parseInt(obj.timestamp_ms) || new Date(obj.timestamp_iso).getTime(),
      note: obj.note ? JSON.parse(obj.note) : "",
    };

    if (!Number.isFinite(reading.glucose_mmol) || reading.glucose_mmol <= 0) {
      continue;
    }
    if (!Number.isFinite(reading.timestamp)) {
      continue;
    }

    readings.push(reading);
  }

  return readings;
}

let pendingImport = [];

function showImportModal(readings) {
  pendingImport = readings;
  els.importPreview.innerHTML = "";

  const preview = readings.slice(0, 5);
  preview.forEach((r) => {
    const div = document.createElement("div");
    div.className = "import-preview-row";
    div.innerHTML = `
      <div class="preview-glucose">${r.glucose_mmol.toFixed(1)} mmol/L</div>
      <div class="preview-time">${formatTime(r.timestamp)}</div>
      <div class="preview-insulin">${r.insulin.toFixed(1)}u</div>
    `;
    els.importPreview.appendChild(div);
  });

  const moreText =
    readings.length > 5
      ? `<div class="preview-more muted small">+ ${readings.length - 5} more readings</div>`
      : "";
  if (moreText) {
    els.importPreview.innerHTML += moreText;
  }

  els.importModal.classList.remove("hidden");
}

async function onImportConfirm() {
  if (pendingImport.length === 0) return;
  try {
    const result = await importReadings(pendingImport);
    showToast(`Imported ${result.imported}, skipped ${result.skipped}`);
    els.importModal.classList.add("hidden");
    pendingImport = [];
    await refresh();
  } catch (err) {
    showToast("Import failed");
    console.error(err);
  }
}

function onImportCancel() {
  els.importModal.classList.add("hidden");
  pendingImport = [];
}

async function onImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const readings = parseCSV(text);
    if (readings.length === 0) {
      showToast("No valid readings found");
      return;
    }
    showImportModal(readings);
  } catch (err) {
    showToast("Failed to read file");
    console.error(err);
  }

  els.importInput.value = "";
}

function renderHistory(readings) {
  els.history.innerHTML = "";
  els.historyCount.textContent =
    readings.length === 0
      ? ""
      : `${readings.length} reading${readings.length === 1 ? "" : "s"}`;
  els.historyEmpty.classList.toggle("hidden", readings.length > 0);

  for (const r of readings) {
    const li = document.createElement("li");
    li.dataset.id = r.id;
    const cls = r.glucose_mmol > 7.8 ? "hi" : r.glucose_mmol < 4.0 ? "lo" : "";
    const isEditing = editingId === r.id;

    if (isEditing) {
      li.innerHTML = `
        <div class="edit-mode">
          <div class="edit-field">
            <label class="small muted">Glucose (mmol/L)</label>
            <input type="number" data-field="glucose" value="${r.glucose_mmol}" step="0.1" min="0" />
          </div>
          <div class="edit-field">
            <label class="small muted">Time</label>
            <input type="datetime-local" data-field="timestamp" value="${toDatetimeLocal(r.timestamp)}" />
          </div>
          <div class="edit-field">
            <label class="small muted">Note</label>
            <input type="text" data-field="note" value="${r.note || ""}" placeholder="(optional)" />
          </div>
          <div class="edit-actions">
            <button class="edit-save primary" data-id="${r.id}">Save</button>
            <button class="edit-cancel ghost" data-id="${r.id}">Cancel</button>
          </div>
        </div>
      `;
    } else {
      li.innerHTML = `
        <div>
          <div class="glucose ${cls}">${r.glucose_mmol.toFixed(1)} <span class="muted small">mmol/L</span></div>
          <div class="when">${formatTime(r.timestamp)}</div>
        </div>
        <div class="insulin">${r.insulin.toFixed(1)}u</div>
        <div class="row-actions">
          <button class="row-edit" data-id="${r.id}" aria-label="Edit">✎</button>
          <button class="row-del" data-id="${r.id}" aria-label="Delete">×</button>
        </div>
        ${r.note ? `<div class="note">${escapeHtml(r.note)}</div>` : ""}
      `;
    }
    els.history.appendChild(li);
  }

  els.history.querySelectorAll("button.row-del").forEach((btn) => {
    btn.addEventListener("click", () => onDelete(btn.dataset.id));
  });
  els.history.querySelectorAll("button.row-edit").forEach((btn) => {
    btn.addEventListener("click", () => onEditStart(btn.dataset.id));
  });
  els.history.querySelectorAll("button.edit-save").forEach((btn) => {
    btn.addEventListener("click", () => onEditSave(btn.dataset.id));
  });
  els.history.querySelectorAll("button.edit-cancel").forEach((btn) => {
    btn.addEventListener("click", onEditCancel);
  });
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function renderLastReadingBadge(readings) {
  if (readings.length === 0) {
    els.lastReading.textContent = "";
    return;
  }
  const r = readings[0];
  els.lastReading.textContent = `${r.glucose_mmol.toFixed(1)} · ${formatTime(r.timestamp)}`;
}

function renderChartSummary(readings) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = readings.filter((r) => r.timestamp >= since);
  if (recent.length === 0) {
    els.chartSummary.textContent = "";
    return;
  }
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

function openSettings() {
  const s = getSyncSettings();
  els.syncEnabled.checked = s.enabled;
  els.syncUrl.value = s.baseUrl;
  els.syncToken.value = s.token;
  els.syncToggleError.classList.add("hidden");
  els.syncPending.textContent = `${getOutboxCount()} readings pending sync`;
  els.settingsOverlay.classList.remove("hidden");
}

function closeSettings() {
  els.settingsOverlay.classList.add("hidden");
}

function onSettingsSave() {
  const enabled = els.syncEnabled.checked;
  const baseUrl = els.syncUrl.value.trim();
  const token = els.syncToken.value.trim();
  if (enabled && (!baseUrl || !token)) {
    els.syncEnabled.checked = false;
    els.syncToggleError.textContent =
      "URL and token are required to enable sync.";
    els.syncToggleError.classList.remove("hidden");
    saveSyncSettings({ enabled: false, baseUrl, token });
    return;
  }
  if (enabled && !baseUrl.startsWith("https://")) {
    els.syncEnabled.checked = false;
    els.syncToggleError.textContent =
      "Sync URL must use https:// to protect your token.";
    els.syncToggleError.classList.remove("hidden");
    saveSyncSettings({ enabled: false, baseUrl, token });
    return;
  }
  els.syncToggleError.classList.add("hidden");
  saveSyncSettings({ enabled, baseUrl, token });
  closeSettings();
  if (enabled) drainOutbox();
}

function bind() {
  els.calcBtn.addEventListener("click", onCalc);
  els.glucose.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onCalc();
  });
  els.note.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSave();
  });
  els.saveBtn.addEventListener("click", onSave);
  els.discardBtn.addEventListener("click", discardPending);
  els.exportBtn.addEventListener("click", onExport);
  els.importBtn.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", onImportFile);
  els.importConfirmBtn.addEventListener("click", onImportConfirm);
  els.importCancelBtn.addEventListener("click", onImportCancel);
  els.clearBtn.addEventListener("click", onClearAll);
  els.timestampToggle.addEventListener("change", () => {
    els.timestampInput.hidden = !els.timestampToggle.checked;
  });
  els.settingsOpenBtn.addEventListener("click", openSettings);
  els.settingsCloseBtn.addEventListener("click", closeSettings);
  els.settingsCancelBtn.addEventListener("click", closeSettings);
  els.settingsSaveBtn.addEventListener("click", onSettingsSave);
  els.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === els.settingsOverlay) closeSettings();
  });
}

async function init() {
  bind();
  await refresh();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  drainOutbox();
  window.addEventListener("online", () => drainOutbox());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") drainOutbox();
  });
  setInterval(
    () => {
      if (document.visibilityState === "visible") drainOutbox();
    },
    5 * 60 * 1000,
  );
}

init();
