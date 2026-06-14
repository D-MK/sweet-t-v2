// Weekly review — builds a structured this-week vs last-week summary and an
// LLM-ready prompt the user can paste into Claude/ChatGPT (or that a future
// server-side scheduled job can consume). See docs/llm-weekly-review.md for the
// fuller design + why the actual LLM call stays out of the client bundle.

import { getAllReadings } from "./db.js";
import {
  TARGET,
  TARGET_LOW,
  TARGET_HIGH,
  LO_THRESHOLD,
  HI_THRESHOLD,
} from "./config.js";
import {
  fmtGlucose,
  fmtThreshold,
  unitLabel,
  toDisplay,
  isMgdl,
} from "./prefs.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function distinctDayCount(readings, valueFn) {
  const days = new Set();
  for (const r of readings) {
    const v = valueFn(r);
    if (v != null && v > 0) days.add(new Date(r.timestamp).toDateString());
  }
  return days.size;
}

// Summarise a 7-day window ending at `end` (exclusive).
function summariseWeek(readings, end, label) {
  const start = end - WEEK_MS;
  const inWindow = readings.filter(
    (r) => r.timestamp >= start && r.timestamp < end,
  );
  const glucose = inWindow.filter((r) => r.glucose_mmol != null);
  const n = glucose.length;
  const avg = n ? glucose.reduce((s, r) => s + r.glucose_mmol, 0) / n : null;
  const inBand = glucose.filter(
    (r) => r.glucose_mmol >= TARGET_LOW && r.glucose_mmol <= TARGET_HIGH,
  ).length;
  const lows = glucose.filter((r) => r.glucose_mmol < LO_THRESHOLD).length;
  const highs = glucose.filter((r) => r.glucose_mmol > HI_THRESHOLD).length;

  const humalogDays = distinctDayCount(inWindow, (r) => r.humalog_units);
  const lantusDays = distinctDayCount(inWindow, (r) => r.lantus_units);
  const carbDays = distinctDayCount(inWindow, (r) => r.carbs_g);
  const totalHumalog = inWindow.reduce((s, r) => s + (r.humalog_units || 0), 0);
  const totalLantus = inWindow.reduce((s, r) => s + (r.lantus_units || 0), 0);
  const totalCarbs = inWindow.reduce((s, r) => s + (r.carbs_g || 0), 0);

  return {
    label,
    glucoseReadings: n,
    avgGlucose: avg,
    timeInBandPct: n ? (inBand / n) * 100 : null,
    lows,
    highs,
    avgDailyHumalog: humalogDays ? totalHumalog / humalogDays : null,
    avgDailyLantus: lantusDays ? totalLantus / lantusDays : null,
    avgDailyCarbs: carbDays ? totalCarbs / carbDays : null,
  };
}

export function buildWeeklyReview(readings, now = Date.now()) {
  return {
    generatedAt: new Date(now).toISOString(),
    target: TARGET,
    band: [TARGET_LOW, TARGET_HIGH],
    thisWeek: summariseWeek(readings, now, "This week"),
    lastWeek: summariseWeek(readings, now - WEEK_MS, "Last week"),
  };
}

function fmt(n, digits = 1, unit = "") {
  return n == null ? "—" : `${n.toFixed(digits)}${unit}`;
}

function delta(a, b, digits = 1) {
  if (a == null || b == null) return "n/a";
  const d = a - b;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(digits)}`;
}

// Glucose value (mmol/L internally) formatted in the active display unit.
function fmtBg(mmol) {
  return mmol == null ? "—" : fmtGlucose(mmol);
}

// Week-on-week glucose delta in the active display unit. Convert the mmol
// difference once (toDisplay rounds for mg/dL) to avoid double-rounding.
function deltaBg(a, b) {
  if (a == null || b == null) return "n/a";
  const d = toDisplay(a - b);
  const sign = d > 0 ? "+" : "";
  return `${sign}${isMgdl() ? d : d.toFixed(1)}`;
}

// Produce a markdown prompt suitable for pasting into an LLM.
export function weeklyReviewPrompt(review) {
  const t = review.thisWeek;
  const l = review.lastWeek;
  const unit = unitLabel();
  const targetStr = fmtThreshold(review.target);
  const bandStr = `${fmtThreshold(review.band[0])}–${fmtThreshold(review.band[1])}`;
  return `You are a diabetes self-management coach. Compare these two weeks of glucose/insulin logs and give me a short, practical review. Target glucose is ${targetStr} ${unit} (in-band ${bandStr}). Focus on: week-on-week changes, any time-of-day patterns I should watch, and 2-3 concrete things to try to get closer to ${targetStr}. Be direct, no medical disclaimers.

| Metric | This week | Last week | Δ |
|---|---|---|---|
| Glucose readings | ${t.glucoseReadings} | ${l.glucoseReadings} | ${delta(t.glucoseReadings, l.glucoseReadings, 0)} |
| Avg glucose (${unit}) | ${fmtBg(t.avgGlucose)} | ${fmtBg(l.avgGlucose)} | ${deltaBg(t.avgGlucose, l.avgGlucose)} |
| Time in band ${bandStr} (%) | ${fmt(t.timeInBandPct, 0)} | ${fmt(l.timeInBandPct, 0)} | ${delta(t.timeInBandPct, l.timeInBandPct, 0)} |
| Lows (<${fmtThreshold(LO_THRESHOLD)} ${unit}) | ${t.lows} | ${l.lows} | ${delta(t.lows, l.lows, 0)} |
| Highs (>${fmtThreshold(HI_THRESHOLD)} ${unit}) | ${t.highs} | ${l.highs} | ${delta(t.highs, l.highs, 0)} |
| Avg daily Humalog (u) | ${fmt(t.avgDailyHumalog)} | ${fmt(l.avgDailyHumalog)} | ${delta(t.avgDailyHumalog, l.avgDailyHumalog)} |
| Avg daily Lantus (u) | ${fmt(t.avgDailyLantus)} | ${fmt(l.avgDailyLantus)} | ${delta(t.avgDailyLantus, l.avgDailyLantus)} |
| Avg daily carbs (g) | ${fmt(t.avgDailyCarbs, 0)} | ${fmt(l.avgDailyCarbs, 0)} | ${delta(t.avgDailyCarbs, l.avgDailyCarbs, 0)} |

Generated ${review.generatedAt}.`;
}

// Build the review from current data and copy the LLM prompt to the clipboard.
export async function copyWeeklyReview() {
  const readings = await getAllReadings();
  const review = buildWeeklyReview(readings);
  const text = weeklyReviewPrompt(review);
  await navigator.clipboard.writeText(text);
  return { review, text };
}
