// Google Drive backup — fire-and-forget daily snapshot to the app's private
// appDataFolder, with manual back-up / restore.
//
// SECURITY: the OAuth Client ID is PUBLIC (not a secret) and may live in a
// static bundle / localStorage. The `drive.appdata` scope is sandboxed to a
// hidden folder this app owns — it cannot read the user's other Drive files.
// No client secret is ever used (token client / implicit flow). Access tokens
// are short-lived and kept in memory only.
//
// GRACEFUL DEGRADATION: every entry point no-ops (or throws only when the user
// explicitly asked) if GIS is unloaded, the client ID is unset, or we're
// offline. Local IndexedDB stays the source of truth; Drive is a backup.

import { getAllReadings, importReadings } from "./db.js";

const CFG_KEY = "sweet_t_gdrive"; // { clientId, enabled }
const META_KEY = "sweet_t_gdrive_meta"; // { lastSync, fileId }
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const BACKUP_NAME = "sweet-t-backup.json";
// ~daily: only auto-sync if it has been at least this long since the last one.
const SYNC_INTERVAL_MS = 20 * 60 * 60 * 1000;

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

export function getGdriveConfig() {
  try {
    return (
      JSON.parse(localStorage.getItem(CFG_KEY) || "null") || {
        clientId: "",
        enabled: false,
      }
    );
  } catch {
    return { clientId: "", enabled: false };
  }
}

export function saveGdriveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function getMeta() {
  try {
    return (
      JSON.parse(localStorage.getItem(META_KEY) || "null") || {
        lastSync: 0,
        fileId: null,
      }
    );
  } catch {
    return { lastSync: 0, fileId: null };
  }
}

function setMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function getLastSync() {
  return getMeta().lastSync || 0;
}

function gisReady() {
  return (
    typeof google !== "undefined" &&
    google.accounts &&
    google.accounts.oauth2 &&
    typeof google.accounts.oauth2.initTokenClient === "function"
  );
}

export function isConnected() {
  return !!accessToken && Date.now() < tokenExpiry;
}

function ensureTokenClient(clientId) {
  if (!gisReady() || !clientId) return null;
  if (!tokenClient || tokenClient._clientId !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {}, // replaced per-request below
    });
    tokenClient._clientId = clientId;
  }
  return tokenClient;
}

// prompt: "consent" forces the account/consent UI (first connect),
// "" attempts a silent refresh of an existing grant.
function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    const cfg = getGdriveConfig();
    const tc = ensureTokenClient(cfg.clientId);
    if (!tc) {
      reject(new Error("Google sign-in is not available right now."));
      return;
    }
    tc.callback = (resp) => {
      if (resp && resp.error) {
        reject(new Error(resp.error));
        return;
      }
      accessToken = resp.access_token;
      const ttl = resp.expires_in ? resp.expires_in * 1000 : 3600 * 1000;
      tokenExpiry = Date.now() + ttl - 60000; // refresh a minute early
      resolve(accessToken);
    };
    try {
      tc.requestAccessToken({ prompt });
    } catch (err) {
      reject(err);
    }
  });
}

async function getToken(interactive) {
  if (isConnected()) return accessToken;
  return requestToken(interactive ? "consent" : "");
}

// Interactive — user clicked "Connect".
export async function connect() {
  const cfg = getGdriveConfig();
  if (!cfg.clientId) {
    throw new Error("Enter a Google OAuth Client ID first.");
  }
  await getToken(true);
  saveGdriveConfig({ ...cfg, enabled: true });
  return true;
}

export function disconnect() {
  const cfg = getGdriveConfig();
  if (accessToken && gisReady()) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {});
    } catch {
      /* best effort */
    }
  }
  accessToken = null;
  tokenExpiry = 0;
  saveGdriveConfig({ ...cfg, enabled: false });
}

async function findBackupFileId(token) {
  const q = encodeURIComponent(`name='${BACKUP_NAME}'`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`);
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : null;
}

function buildSnapshot(readings) {
  return JSON.stringify({
    app: "sweet-t-v2",
    version: 1,
    exportedAt: new Date().toISOString(),
    count: readings.length,
    readings,
  });
}

async function uploadSnapshot(token, body, existingId) {
  const boundary = "sweet-t-" + Math.random().toString(36).slice(2);
  const metadata = existingId
    ? {}
    : { name: BACKUP_NAME, parents: ["appDataFolder"] };
  const multipart =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    body +
    `\r\n--${boundary}--`;
  const method = existingId ? "PATCH" : "POST";
  const idPart = existingId ? `/${existingId}` : "";
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files${idPart}?uploadType=multipart&fields=id`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    },
  );
  if (!res.ok) throw new Error(`Drive upload failed (${res.status})`);
  const data = await res.json();
  return data.id;
}

// Interactive back-up: ensures a token (prompting if needed), writes the snapshot.
export async function backupNow() {
  const token = await getToken(true);
  const readings = await getAllReadings();
  const meta = getMeta();
  let fileId = meta.fileId;
  if (!fileId) fileId = await findBackupFileId(token);
  const newId = await uploadSnapshot(token, buildSnapshot(readings), fileId);
  setMeta({ lastSync: Date.now(), fileId: newId });
  return { count: readings.length };
}

// Silent daily sync — called on load / visibility. Never throws.
export async function maybeDailySync() {
  try {
    const cfg = getGdriveConfig();
    if (!cfg.enabled || !cfg.clientId) return;
    if (!navigator.onLine) return;
    if (!gisReady()) return;
    const meta = getMeta();
    if (Date.now() - (meta.lastSync || 0) < SYNC_INTERVAL_MS) return;
    const token = await getToken(false); // silent — no consent popup
    const readings = await getAllReadings();
    let fileId = meta.fileId || (await findBackupFileId(token));
    const newId = await uploadSnapshot(token, buildSnapshot(readings), fileId);
    setMeta({ lastSync: Date.now(), fileId: newId });
  } catch (err) {
    // Backup is best-effort; local data is unaffected.
    console.warn("Sweet-T Drive sync skipped:", err && err.message);
  }
}

// Interactive restore: pulls the snapshot and merges into IndexedDB (dedup by id).
export async function restoreFromDrive() {
  const token = await getToken(true);
  const meta = getMeta();
  const fileId = meta.fileId || (await findBackupFileId(token));
  if (!fileId) return { imported: 0, skipped: 0, total: 0, empty: true };
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
  const data = await res.json();
  const readings = Array.isArray(data.readings) ? data.readings : [];
  const result = await importReadings(readings);
  setMeta({ ...getMeta(), fileId });
  return result;
}
