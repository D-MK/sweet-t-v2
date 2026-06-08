// Shared glucose targets + thresholds — single source of truth.
// All values are mmol/L. Imported by chart.js, metrics.js, weekly.js.

// Personal glucose target and the +/- 1 band drawn on the chart.
export const TARGET = 6;
export const TARGET_LOW = TARGET - 1; // 5 — band floor
export const TARGET_HIGH = TARGET + 1; // 7 — band ceiling

// Clinical thresholds (unchanged from the original chart).
export const LO_THRESHOLD = 4.0; // hypo — treat with carbs, never insulin
export const HI_THRESHOLD = 7.8; // hyper ceiling

// Returns a colour for a glucose value relative to the target band.
// Used by the metrics heatmap and any "how am I doing" colour coding.
// Falls back to the CSS custom properties so it tracks the active theme.
export function glucoseColour(mmol) {
  if (mmol == null || !Number.isFinite(mmol)) return "var(--heat-empty)";
  if (mmol < LO_THRESHOLD) return "var(--danger)"; // low
  if (mmol > HI_THRESHOLD) return "var(--warn-hi, var(--warn))"; // high
  if (mmol >= TARGET_LOW && mmol <= TARGET_HIGH) return "var(--good)"; // in band
  return "var(--warn)"; // near-target shoulder (4-5 or 7-7.8)
}
