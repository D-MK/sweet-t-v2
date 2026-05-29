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
  humalog: $("humalog"),
  lantus: $("lantus"),
  saveBtn: $("save"),
  discardBtn: $("discard"),
  insulinOnlyToggle: $("insulin-only-toggle"),
  insulinOnly: $("insulin-only"),
  ioHumalog: $("io-humalog"),
  ioLantus: $("io-lantus"),
  ioNote: $("io-note"),
  ioTimestampToggle: $("io-timestamp-toggle"),
  ioTimestampInput: $("io-timestamp-input"),
  ioSaveBtn: $("io-save"),
  ioCancelBtn: $("io-cancel"),
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

function parseDose(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

function fmtDose(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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
  els.humalog.value = fmtDose(pending.insulin);
  els.lantus.value = "";
  els.note.value = "";
  els.note.focus({ preventScroll: true });
}

function discardPending() {
  pending = null;
  els.result.classList.add("hidden");
  els.glucose.value = "";
  els.humalog.value = "";
  els.lantus.value = "";
  els.glucose.focus();
}

function toggleInsulinOnly(show) {
  const open =
    show != null ? show : els.insulinOnly.classList.contains("hidden");
  els.insulinOnly.classList.toggle("hidden", !open);
  if (open) {
    els.ioHumalog.value = "";
    els.ioLantus.value = "";
    els.ioNote.value = "";
    els.ioTimestampToggle.checked = false;
    els.ioTimestampInput.hidden = true;
    els.ioTimestampInput.value = toDatetimeLocal(Date.now());
    els.ioHumalog.focus({ preventScroll: true });
  }
}

async function onInsulinOnlySave() {
  const humalog = parseDose(els.ioHumalog.value);
  const lantus = parseDose(els.ioLantus.value);
  if (humalog == null && lantus == null) {
    showToast("Enter a Humalog or Lantus dose");
    return;
  }
  const timestamp = els.ioTimestampToggle.checked
    ? fromDatetimeLocal(els.ioTimestampInput.value)
    : Date.now();
  const reading = {
    id: crypto.randomUUID(),
    timestamp,
    glucose_mmol: null,
    glucose_mgdl: null,
    insulin: null,
    humalog_units: humalog,
    lantus_units: lantus,
    note: els.ioNote.value.trim(),
  };
  try {
    await addReading(reading);
    showToast("Insulin logged");
    toggleInsulinOnly(false);
    await refresh();
  } catch (err) {
    showToast("Save failed");
    console.error(err);
  }
}

async function onSave() {
  if (!pending) return;
  pending.note = els.note.value.trim();
  pending.humalog_units = parseDose(els.humalog.value);
  pending.lantus_units = parseDose(els.lantus.value);
  if (els.timestampToggle.checked) {
    pending.timestamp = fromDatetimeLocal(els.timestampInput.value);
  } else {
    pending.timestamp = Date.now();
  }
  try {
    await addReading(pending);
    const settings = getSyncSettings();
    if (settings.enabled && pending.glucose_mgdl != null) {
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
  const humalogInput = li.querySelector('[data-field="humalog"]');
  const lantusInput = li.querySelector('[data-field="lantus"]');

  const glucoseRaw = glucoseInput.value.trim();
  const hasGlucose = glucoseRaw !== "";
  const glucose = parseFloat(glucoseRaw);
  if (hasGlucose && (!Number.isFinite(glucose) || glucose <= 0)) {
    showToast("Invalid glucose value");
    return;
  }
  const humalog = parseDose(humalogInput.value);
  const lantus = parseDose(lantusInput.value);
  if (!hasGlucose && humalog == null && lantus == null) {
    showToast("Need a glucose or insulin value");
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

  const updates = {
    timestamp,
    note,
    humalog_units: humalog,
    lantus_units: lantus,
  };
  if (hasGlucose) {
    const { mgdl, insulin } = calculateInsulin(glucose);
    updates.glucose_mmol = glucose;
    updates.glucose_mgdl = Math.round(mgdl * 10) / 10;
    updates.insulin = Math.round(insulin * 10) / 10;
  } else {
    updates.glucose_mmol = null;
    updates.glucose_mgdl = null;
    updates.insulin = null;
  }
  try {
    await updateReading(id, updates);
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
    "id,timestamp_iso,timestamp_ms,glucose_mmol,glucose_mgdl,insulin_units,humalog_units,lantus_units,note\n";
  const rows = all.map((r) =>
    [
      r.id,
      new Date(r.timestamp).toISOString(),
      r.timestamp,
      r.glucose_mmol ?? "",
      r.glucose_mgdl ?? "",
      r.insulin ?? "",
      r.humalog_units ?? "",
      r.lantus_units ?? "",
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

    const glucoseMmol = parseFloat(obj.glucose_mmol);
    const glucoseMgdl = parseFloat(obj.glucose_mgdl);
    const insulin = parseFloat(obj.insulin_units);
    const humalog = parseFloat(obj.humalog_units);
    const lantus = parseFloat(obj.lantus_units);
    const hasGlucose = Number.isFinite(glucoseMmol) && glucoseMmol > 0;
    const reading = {
      id: obj.id || crypto.randomUUID(),
      glucose_mmol: hasGlucose ? glucoseMmol : null,
      glucose_mgdl: Number.isFinite(glucoseMgdl) ? glucoseMgdl : null,
      insulin: Number.isFinite(insulin) ? insulin : null,
      humalog_units: Number.isFinite(humalog) && humalog > 0 ? humalog : null,
      lantus_units: Number.isFinite(lantus) && lantus > 0 ? lantus : null,
      timestamp:
        parseInt(obj.timestamp_ms) || new Date(obj.timestamp_iso).getTime(),
      note: obj.note ? JSON.parse(obj.note) : "",
    };

    if (!Number.isFinite(reading.timestamp)) {
      continue;
    }
    if (
      !hasGlucose &&
      reading.humalog_units == null &&
      reading.lantus_units == null
    ) {
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
    const glucoseLabel =
      r.glucose_mmol != null
        ? `${r.glucose_mmol.toFixed(1)} mmol/L`
        : "Insulin only";
    const doseLabel =
      [
        r.humalog_units != null ? `${fmtDose(r.humalog_units)}u H` : null,
        r.lantus_units != null ? `${fmtDose(r.lantus_units)}u L` : null,
      ]
        .filter(Boolean)
        .join(" · ") || (r.insulin != null ? `${r.insulin.toFixed(1)}u` : "");
    div.innerHTML = `
      <div class="preview-glucose">${glucoseLabel}</div>
      <div class="preview-time">${formatTime(r.timestamp)}</div>
      <div class="preview-insulin">${doseLabel}</div>
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
      const hasGlucose = r.glucose_mmol != null;
      li.innerHTML = `
        <div class="edit-mode">
          <div class="edit-field">
            <label class="small muted">Glucose (mmol/L)</label>
            <input type="number" data-field="glucose" value="${hasGlucose ? r.glucose_mmol : ""}" step="0.1" min="0" placeholder="(insulin only)" />
          </div>
          <div class="edit-field">
            <label class="small muted">Humalog (u)</label>
            <input type="number" data-field="humalog" value="${r.humalog_units ?? ""}" step="0.5" min="0" placeholder="(optional)" />
          </div>
          <div class="edit-field">
            <label class="small muted">Lantus (u)</label>
            <input type="number" data-field="lantus" value="${r.lantus_units ?? ""}" step="0.5" min="0" placeholder="(optional)" />
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
      const glucoseHtml =
        r.glucose_mmol != null
          ? `<div class="glucose ${cls}">${r.glucose_mmol.toFixed(1)} <span class="muted small">mmol/L</span></div>`
          : `<div class="glucose insulin-only-label">Insulin only</div>`;
      const doseParts = [];
      if (r.humalog_units != null)
        doseParts.push(
          `<span class="dose humalog">${fmtDose(r.humalog_units)}u H</span>`,
        );
      if (r.lantus_units != null)
        doseParts.push(
          `<span class="dose lantus">${fmtDose(r.lantus_units)}u L</span>`,
        );
      if (doseParts.length === 0 && r.insulin != null)
        doseParts.push(`<span class="insulin">${r.insulin.toFixed(1)}u</span>`);
      li.innerHTML = `
        <div>
          ${glucoseHtml}
          <div class="when">${formatTime(r.timestamp)}</div>
        </div>
        <div class="doses">${doseParts.join("")}</div>
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
  const label =
    r.glucose_mmol != null
      ? r.glucose_mmol.toFixed(1)
      : [
          r.humalog_units != null ? `${fmtDose(r.humalog_units)}u H` : null,
          r.lantus_units != null ? `${fmtDose(r.lantus_units)}u L` : null,
        ]
          .filter(Boolean)
          .join(" ");
  els.lastReading.textContent = `${label} · ${formatTime(r.timestamp)}`;
}

function renderChartSummary(readings) {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = readings.filter(
    (r) => r.timestamp >= since && r.glucose_mmol != null,
  );
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
  els.insulinOnlyToggle.addEventListener("click", () => toggleInsulinOnly());
  els.ioSaveBtn.addEventListener("click", onInsulinOnlySave);
  els.ioCancelBtn.addEventListener("click", () => toggleInsulinOnly(false));
  els.ioTimestampToggle.addEventListener("change", () => {
    els.ioTimestampInput.hidden = !els.ioTimestampToggle.checked;
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
