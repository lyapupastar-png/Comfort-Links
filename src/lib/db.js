const DB_NAME = 'comfort-links';
const VERSION = 2;
const STORES = ['icons', 'wallpapers'];
let dbPromise = null;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const dbGet = (store, key) => run(store, 'readonly', (s) => s.get(key)).catch(() => undefined);
export const dbPut = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)).catch(() => undefined);
export const dbDelete = (store, key) => run(store, 'readwrite', (s) => s.delete(key)).catch(() => undefined);
