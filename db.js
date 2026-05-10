const DB_NAME = 'sweet-t';
const DB_VERSION = 1;
const STORE = 'readings';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

export async function addReading(reading) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.add(reading);
    req.onsuccess = () => resolve(reading);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteReading(id) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll() {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllReadings() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.index('timestamp').getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.timestamp - a.timestamp));
    req.onerror = () => reject(req.error);
  });
}

export async function getReadingsSince(sinceTs) {
  const all = await getAllReadings();
  return all.filter(r => r.timestamp >= sinceTs);
}
