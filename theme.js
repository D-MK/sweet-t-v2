// Theme manager — mirrors the otto-ai pattern (named presets via CSS variables,
// persisted to localStorage), adapted for vanilla CSS custom properties.
// The palettes themselves live in styles.css under [data-theme="…"]; this module
// only flips the attribute on <html>, keeps the PWA status-bar colour in sync,
// and persists the choice.

const STORAGE_KEY = "sweet_t_theme";

// label = what shows in the Settings dropdown; meta = PWA theme-color.
export const THEMES = [
  { id: "dark", label: "Dark", meta: "#0b1220" },
  { id: "light", label: "Light", meta: "#f8fafc" },
  { id: "ocean", label: "Ocean", meta: "#0e7490" },
  { id: "sunset", label: "Sunset", meta: "#7c2d12" },
  { id: "midnight", label: "Midnight", meta: "#0a0a0f" },
];

const DEFAULT = "dark";

function isValid(id) {
  return THEMES.some((t) => t.id === id);
}

export function getTheme() {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return isValid(t) ? t : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function applyTheme(id) {
  const theme = isValid(id) ? id : DEFAULT;
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  const def = THEMES.find((t) => t.id === theme);
  if (meta && def) meta.setAttribute("content", def.meta);
}

export function saveTheme(id) {
  const theme = isValid(id) ? id : DEFAULT;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore quota / private-mode errors */
  }
  applyTheme(theme);
}

export function initTheme() {
  applyTheme(getTheme());
}
