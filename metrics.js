import { getAllReadings } from "./db.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// eAG → HbA1c: hba1c% = (avg_mgdl + 46.7) / 28.7  (ADAG study, Nathan et al. 2008)
const EAG_OFFSET = 46.7;
const EAG_DIVISOR = 28.7;

const WINDOWS = [7, 14, 30];

function mgdlToMmol(mgdl) {
  return mgdl / 18;
}

export function computeWindow(readings, days, now = Date.now()) {
  const since = now - days * DAY_MS;
  const inWindow = readings.filter(
    (r) => r.timestamp >= since && r.timestamp <= now,
  );

  const glucoseReadings = inWindow.filter((r) => r.glucose_mgdl != null);
  let estHba1c = null;
  let minMmol = null;
  let maxMmol = null;

  if (glucoseReadings.length > 0) {
    const avgMgdl =
      glucoseReadings.reduce((s, r) => s + r.glucose_mgdl, 0) /
      glucoseReadings.length;
    estHba1c = (avgMgdl + EAG_OFFSET) / EAG_DIVISOR;

    const mmolValues = glucoseReadings.map((r) =>
      r.glucose_mmol != null ? r.glucose_mmol : mgdlToMmol(r.glucose_mgdl),
    );
    minMmol = Math.min(...mmolValues);
    maxMmol = Math.max(...mmolValues);
  }

  // "Average daily" = total ÷ days in the window, not ÷ days-with-data.
  const totalHumalog = inWindow.reduce((s, r) => s + (r.humalog_units || 0), 0);
  const totalLantus = inWindow.reduce((s, r) => s + (r.lantus_units || 0), 0);
  const totalCarbs = inWindow.reduce((s, r) => s + (r.carbs_g || 0), 0);

  return {
    days,
    entries: inWindow.length,
    glucoseCount: glucoseReadings.length,
    estHba1c,
    minMmol,
    maxMmol,
    avgDailyHumalog: totalHumalog / days,
    avgDailyLantus: totalLantus / days,
    avgDailyCarbs: totalCarbs / days,
  };
}

export function computeAllWindows(readings, now = Date.now()) {
  return WINDOWS.map((d) => computeWindow(readings, d, now));
}

function fmt1(n) {
  return n.toFixed(1);
}

function fmt0(n) {
  return n.toFixed(0);
}

function metricCell(label, value, unit) {
  const cell = document.createElement("div");
  cell.className = "metric";
  cell.innerHTML = `
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}<span class="metric-unit muted small">${unit}</span></div>
  `;
  return cell;
}

function renderCard(window) {
  const card = document.createElement("section");
  card.className = "card metrics-card";
  card.dataset.window = String(window.days);

  const header = document.createElement("div");
  header.className = "row between";
  const entryLabel =
    window.entries === 1 ? "1 entry" : `${window.entries} entries`;
  header.innerHTML = `
    <h2>Last ${window.days} days</h2>
    <span class="muted small">${entryLabel}</span>
  `;
  card.appendChild(header);

  if (window.entries === 0) {
    const empty = document.createElement("p");
    empty.className = "muted small empty metrics-empty";
    empty.textContent = "No readings in this window.";
    card.appendChild(empty);
    return card;
  }

  const grid = document.createElement("div");
  grid.className = "metrics-grid";

  const hba1cValue = window.estHba1c != null ? fmt1(window.estHba1c) : "—";
  const minValue = window.minMmol != null ? fmt1(window.minMmol) : "—";
  const maxValue = window.maxMmol != null ? fmt1(window.maxMmol) : "—";
  const glucoseUnit = window.estHba1c != null ? "% est." : "";
  const mmolUnit = window.minMmol != null ? "mmol/L" : "";

  grid.appendChild(metricCell("HbA1c", hba1cValue, glucoseUnit));
  grid.appendChild(metricCell("Min glucose", minValue, mmolUnit));
  grid.appendChild(metricCell("Max glucose", maxValue, mmolUnit));
  grid.appendChild(
    metricCell("Avg daily Humalog", fmt1(window.avgDailyHumalog), "u"),
  );
  grid.appendChild(
    metricCell("Avg daily Lantus", fmt1(window.avgDailyLantus), "u"),
  );
  grid.appendChild(
    metricCell("Avg daily carbs", fmt0(window.avgDailyCarbs), "g"),
  );

  card.appendChild(grid);

  if (window.estHba1c != null && window.glucoseCount < window.days) {
    const note = document.createElement("p");
    note.className = "muted small metrics-note";
    note.textContent = `Based on ${window.glucoseCount} glucose ${window.glucoseCount === 1 ? "reading" : "readings"} — estimate is rough with sparse data.`;
    card.appendChild(note);
  }

  return card;
}

export async function renderMetrics(container) {
  const readings = await getAllReadings();
  container.innerHTML = "";
  const windows = computeAllWindows(readings);
  for (const w of windows) {
    container.appendChild(renderCard(w));
  }
}
