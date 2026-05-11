const SETTINGS_KEY = "sweet_t_sync_settings";
const OUTBOX_KEY = "sweet_t_outbox";

let isDraining = false;

export function getSyncSettings() {
  try {
    return (
      JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {
        enabled: false,
        baseUrl: "",
        token: "",
      }
    );
  } catch {
    return { enabled: false, baseUrl: "", token: "" };
  }
}

export function saveSyncSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function getOutbox() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveOutbox(outbox) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
}

export function getOutboxCount() {
  return getOutbox().length;
}

export function enqueue(reading) {
  const outbox = getOutbox();
  outbox.push({
    id: reading.id,
    mg_dl: Math.round(reading.glucose_mgdl),
    recorded_at: new Date(reading.timestamp).toISOString(),
    attempts: 0,
    last_attempt_at: null,
  });
  saveOutbox(outbox);
}

export async function drainOutbox() {
  if (isDraining) return;
  const settings = getSyncSettings();
  if (!settings.enabled || !settings.baseUrl || !settings.token) return;
  isDraining = true;
  try {
    const outbox = getOutbox();
    if (outbox.length === 0) return;
    const remaining = [];
    for (const entry of outbox) {
      const now = new Date().toISOString();
      try {
        const res = await fetch(`${settings.baseUrl}/v1/glucose`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${settings.token}`,
          },
          body: JSON.stringify({
            mg_dl: entry.mg_dl,
            recorded_at: entry.recorded_at,
          }),
        });
        if (res.status === 201) {
          continue;
        } else if (res.status === 400 || res.status === 401) {
          entry.attempts += 1;
          entry.last_attempt_at = now;
          if (entry.attempts >= 3) {
            console.warn(
              "Sweet-T sync: permanent drop",
              entry.id,
              "after",
              entry.attempts,
              "attempts",
            );
            continue;
          }
          remaining.push(entry);
        } else {
          entry.attempts += 1;
          entry.last_attempt_at = now;
          if (entry.attempts >= 5) {
            console.warn(
              "Sweet-T sync: permanent drop",
              entry.id,
              "after",
              entry.attempts,
              "attempts",
            );
            continue;
          }
          remaining.push(entry);
        }
      } catch {
        entry.attempts += 1;
        entry.last_attempt_at = new Date().toISOString();
        if (entry.attempts >= 5) {
          console.warn("Sweet-T sync: permanent failure for reading", entry);
          continue;
        }
        remaining.push(entry);
      }
    }
    saveOutbox(remaining);
  } finally {
    isDraining = false;
  }
}
