// User preferences beyond theme — glucose display unit + default Lantus dose.
// Mirrors the theme.js pattern (localStorage-backed, validated, graceful in
// private mode). Clinical constants live in config.js and stay in mmol/L; this
// module is the single place that converts mmol/L <-> mg/dL for display + input.

const UNIT_KEY = "sweet_t_glucose_unit";
const LANTUS_KEY = "sweet_t_lantus_default";

// 1 mmol/L glucose == 18 mg/dL (the standard molar-mass conversion).
export const MMOL_TO_MGDL = 18;

export const UNITS = [
  { id: "mmol", label: "mmol/L" },
  { id: "mgdl", label: "mg/dL" },
];

const DEFAULT_UNIT = "mmol";
const DEFAULT_LANTUS = 28;
const LANTUS_MAX = 60; // matches DOSE_RANGES.lantus in app.js

function isValidUnit(u) {
  return u === "mmol" || u === "mgdl";
}

export function getUnit() {
  try {
    const u = localStorage.getItem(UNIT_KEY);
    return isValidUnit(u) ? u : DEFAULT_UNIT;
  } catch {
    return DEFAULT_UNIT;
  }
}

export function saveUnit(u) {
  const unit = isValidUnit(u) ? u : DEFAULT_UNIT;
  try {
    localStorage.setItem(UNIT_KEY, unit);
  } catch {
    /* ignore quota / private-mode errors */
  }
  return unit;
}

export function isMgdl() {
  return getUnit() === "mgdl";
}

export function unitLabel() {
  return isMgdl() ? "mg/dL" : "mmol/L";
}

// Step + placeholder for the glucose <input> in the active unit.
export function glucoseStep() {
  return isMgdl() ? 1 : 0.1;
}

export function glucosePlaceholder() {
  return isMgdl() ? "e.g. 130" : "e.g. 7.2";
}

// Format an internally-stored mmol/L value for display in the active unit.
// mg/dL shows as a whole number; mmol/L keeps one decimal.
export function fmtGlucose(mmol) {
  if (mmol == null || !Number.isFinite(mmol)) return "";
  return isMgdl() ? String(Math.round(mmol * MMOL_TO_MGDL)) : mmol.toFixed(1);
}

// Same, with the unit suffix appended ("7.2 mmol/L" / "130 mg/dL").
export function fmtGlucoseUnit(mmol) {
  const v = fmtGlucose(mmol);
  return v === "" ? "" : `${v} ${unitLabel()}`;
}

// Format a clinical threshold (given in mmol/L) for display in the active unit.
export function fmtThreshold(mmol) {
  return isMgdl() ? String(Math.round(mmol * MMOL_TO_MGDL)) : String(mmol);
}

// Numeric display value (no formatting) — for chart inputs that need a number.
export function toDisplay(mmol) {
  if (mmol == null || !Number.isFinite(mmol)) return null;
  return isMgdl() ? Math.round(mmol * MMOL_TO_MGDL) : mmol;
}

// Parse a user-entered glucose value (in the active unit) back to mmol/L for
// storage + the insulin formula. Returns null for blank/invalid/non-positive.
export function parseGlucoseToMmol(raw) {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return isMgdl() ? n / MMOL_TO_MGDL : n;
}

export function getLantusDefault() {
  try {
    const v = parseInt(localStorage.getItem(LANTUS_KEY), 10);
    if (Number.isFinite(v) && v >= 0 && v <= LANTUS_MAX) return v;
  } catch {
    /* fall through to default */
  }
  return DEFAULT_LANTUS;
}

export function saveLantusDefault(value) {
  let v = parseInt(value, 10);
  if (!Number.isFinite(v) || v < 0) v = DEFAULT_LANTUS;
  if (v > LANTUS_MAX) v = LANTUS_MAX;
  try {
    localStorage.setItem(LANTUS_KEY, String(v));
  } catch {
    /* ignore quota / private-mode errors */
  }
  return v;
}

export { DEFAULT_LANTUS, LANTUS_MAX };
