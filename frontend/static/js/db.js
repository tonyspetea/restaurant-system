/**
 * db.js — IndexedDB wrapper for offline-first storage
 * Stores cart state, offline queue, and cached orders
 */
const DB = (() => {
  const DB_NAME = 'restopos';
  const DB_VER  = 1;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('queue')) {
          db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function enqueue(action, payload) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('queue', 'readwrite');
      const req = tx.objectStore('queue').add({ action, payload, ts: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function getQueue() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function clearQueue() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('queue', 'readwrite');
      const req = tx.objectStore('queue').clear();
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function setCache(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('cache', 'readwrite');
      const req = tx.objectStore('cache').put({ key, value, ts: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function getCache(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function queueLength() {
    const q = await getQueue();
    return q.length;
  }

  return { enqueue, getQueue, clearQueue, setCache, getCache, queueLength };
})();
