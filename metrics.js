import { getAllReadings } from "./db.js";
import {
  TARGET,
  TARGET_LOW,
  TARGET_HIGH,
  LO_THRESHOLD,
  HI_THRESHOLD,
  glucoseColour,
} from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// eAG → HbA1c: hba1c% = (avg_mgdl + 46.7) / 28.7  (ADAG study, Nathan et al. 2008)
const EAG_OFFSET = 46.7;
const EAG_DIVISOR = 28.7;

const WINDOWS = [7, 14, 30];

// 8 three-hour bands of local hour-of-day, labelled by band start.
const HEAT_BANDS = [0, 3, 6, 9, 12, 15, 18, 21];
const HEAT_LABELS = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];

function mgdlToMmol(mgdl) {
  return mgdl / 18;
}

// Distinct local calendar days that contain at least one record whose
// valueFn yields a present, positive value (> 0).
function distinctDayCount(readings, valueFn) {
  const days = new Set();
  for (const r of readings) {
    const v = valueFn(r);
    if (v != null && v > 0) days.add(new Date(r.timestamp).toDateString());
  }
  return days.size;
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

  // "Average daily" = total ÷ distinct local calendar days that actually
  // logged that metric (> 0), not ÷ days in the window. Dividing by the full
  // window understates metrics only logged on a few days (e.g. a recently
  // added Lantus dose showing a fake low average over 30 days).
  const totalHumalog = inWindow.reduce((s, r) => s + (r.humalog_units || 0), 0);
  const totalLantus = inWindow.reduce((s, r) => s + (r.lantus_units || 0), 0);
  const totalCarbs = inWindow.reduce((s, r) => s + (r.carbs_g || 0), 0);

  const humalogDays = distinctDayCount(inWindow, (r) => r.humalog_units);
  const lantusDays = distinctDayCount(inWindow, (r) => r.lantus_units);
  const carbsDays = distinctDayCount(inWindow, (r) => r.carbs_g);

  return {
    days,
    entries: inWindow.length,
    glucoseCount: glucoseReadings.length,
    estHba1c,
    minMmol,
    maxMmol,
    avgDailyHumalog: humalogDays ? totalHumalog / humalogDays : null,
    avgDailyLantus: lantusDays ? totalLantus / lantusDays : null,
    avgDailyCarbs: carbsDays ? totalCarbs / carbsDays : null,
    humalogDays,
    lantusDays,
    carbsDays,
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

function overDays(n) {
  return n > 0 ? `over ${n}d` : null;
}

function metricCell(label, value, unit, sub) {
  const cell = document.createElement("div");
  cell.className = "metric";
  const subHtml = sub ? `<div class="metric-sub muted small">${sub}</div>` : "";
  cell.innerHTML = `
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}<span class="metric-unit muted small">${unit}</span></div>
    ${subHtml}
  `;
  return cell;
}

function renderCard(window) {
  const card = document.createElement("details");
  card.className = "card metrics-card metrics-collapse";
  card.dataset.window = String(window.days);
  card.open = window.days === 7;

  const summary = document.createElement("summary");
  summary.className = "metrics-summary";
  const entryLabel =
    window.entries === 1 ? "1 entry" : `${window.entries} entries`;
  summary.innerHTML = `
    <span class="metrics-summary-title">Last ${window.days} days</span>
    <span class="muted small metrics-summary-count">${entryLabel}</span>
  `;
  card.appendChild(summary);

  const body = document.createElement("div");
  body.className = "metrics-body";
  card.appendChild(body);

  if (window.entries === 0) {
    const empty = document.createElement("p");
    empty.className = "muted small empty metrics-empty";
    empty.textContent = "No readings in this window.";
    body.appendChild(empty);
    return card;
  }

  const grid = document.createElement("div");
  grid.className = "metrics-grid";

  const hba1cValue = window.estHba1c != null ? fmt1(window.estHba1c) : "—";
  const minValue = window.minMmol != null ? fmt1(window.minMmol) : "—";
  const maxValue = window.maxMmol != null ? fmt1(window.maxMmol) : "—";
  const glucoseUnit = window.estHba1c != null ? "% est." : "";
  const mmolUnit = window.minMmol != null ? "mmol/L" : "";

  const humalogValue =
    window.avgDailyHumalog != null ? fmt1(window.avgDailyHumalog) : "—";
  const lantusValue =
    window.avgDailyLantus != null ? fmt1(window.avgDailyLantus) : "—";
  const carbsValue =
    window.avgDailyCarbs != null ? fmt0(window.avgDailyCarbs) : "—";

  const humalogSub =
    window.avgDailyHumalog != null ? overDays(window.humalogDays) : null;
  const lantusSub =
    window.avgDailyLantus != null ? overDays(window.lantusDays) : null;
  const carbsSub =
    window.avgDailyCarbs != null ? overDays(window.carbsDays) : null;

  grid.appendChild(metricCell("HbA1c", hba1cValue, glucoseUnit));
  grid.appendChild(metricCell("Min glucose", minValue, mmolUnit));
  grid.appendChild(metricCell("Max glucose", maxValue, mmolUnit));
  grid.appendChild(
    metricCell("Avg daily Humalog", humalogValue, "u", humalogSub),
  );
  grid.appendChild(metricCell("Avg daily Lantus", lantusValue, "u", lantusSub));
  grid.appendChild(metricCell("Avg daily carbs", carbsValue, "g", carbsSub));

  body.appendChild(grid);

  if (window.estHba1c != null && window.glucoseCount < window.days) {
    const note = document.createElement("p");
    note.className = "muted small metrics-note";
    note.textContent = `Based on ${window.glucoseCount} glucose ${window.glucoseCount === 1 ? "reading" : "readings"} — estimate is rough with sparse data.`;
    body.appendChild(note);
  }

  return card;
}

function bandIndex(hour) {
  return Math.floor(hour / 3);
}

// Average glucose_mmol by 3-hour local time-of-day band for one window.
// Returns an array of length 8 with null where the band has no readings.
function heatRow(readings, days, now) {
  const since = now - days * DAY_MS;
  const sums = new Array(HEAT_BANDS.length).fill(0);
  const counts = new Array(HEAT_BANDS.length).fill(0);
  for (const r of readings) {
    if (r.timestamp < since || r.timestamp > now) continue;
    if (r.glucose_mmol == null) continue;
    const idx = bandIndex(new Date(r.timestamp).getHours());
    sums[idx] += r.glucose_mmol;
    counts[idx] += 1;
  }
  return sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : null));
}

function renderHeatmap(readings, now = Date.now()) {
  const card = document.createElement("section");
  card.className = "card heatmap-card";

  const heading = document.createElement("h2");
  heading.textContent = "Glucose by time of day";
  card.appendChild(heading);

  const hasGlucose = readings.some((r) => r.glucose_mmol != null);
  if (!hasGlucose) {
    const empty = document.createElement("p");
    empty.className = "muted small empty";
    empty.textContent = "No glucose readings yet.";
    card.appendChild(empty);
    return card;
  }

  const grid = document.createElement("div");
  grid.className = "heatmap";

  const colLabels = document.createElement("div");
  colLabels.className = "heat-col-labels";
  const corner = document.createElement("span");
  corner.className = "heat-corner";
  colLabels.appendChild(corner);
  for (const label of HEAT_LABELS) {
    const head = document.createElement("span");
    head.className = "heat-col-label";
    head.textContent = label;
    colLabels.appendChild(head);
  }
  grid.appendChild(colLabels);

  for (const days of WINDOWS) {
    const row = document.createElement("div");
    row.className = "heat-row";

    const rowLabel = document.createElement("span");
    rowLabel.className = "heat-row-label";
    rowLabel.textContent = `${days}d`;
    row.appendChild(rowLabel);

    const avgs = heatRow(readings, days, now);
    for (const avg of avgs) {
      const cell = document.createElement("span");
      if (avg == null) {
        cell.className = "heat-cell heat-empty";
        cell.style.background = "var(--heat-empty)";
        cell.textContent = "";
      } else {
        cell.className = "heat-cell heat-hot";
        cell.style.background = glucoseColour(avg);
        cell.textContent = fmt1(avg);
      }
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }

  card.appendChild(grid);

  const legend = document.createElement("div");
  legend.className = "heat-legend";
  legend.innerHTML = `
    <span class="heat-swatch" style="background:var(--danger)"></span>
    <span class="muted small">Low</span>
    <span class="heat-swatch" style="background:var(--good)"></span>
    <span class="muted small">Target ${TARGET_LOW}–${TARGET_HIGH}</span>
    <span class="heat-swatch" style="background:var(--warn)"></span>
    <span class="muted small">High</span>
    <span class="muted small">· blank = no data</span>
  `;
  card.appendChild(legend);

  return card;
}

export async function renderMetrics(container) {
  const readings = await getAllReadings();
  container.innerHTML = "";
  container.appendChild(renderHeatmap(readings));
  const windows = computeAllWindows(readings);
  for (const w of windows) {
    container.appendChild(renderCard(w));
  }
}
