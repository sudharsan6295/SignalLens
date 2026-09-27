/* Tiny IndexedDB key-value wrapper. Imported conversations can be large (tens of MB),
   which is why they live here rather than in localStorage (~5 MB cap). If IndexedDB
   is unavailable (private mode in some browsers), it falls back to memory: the app
   still works, it just forgets the data on reload. */
(function () {
  "use strict";
  const Lens = window.Lens;
  const DB_NAME = "signal-lens";
  const STORE = "kv";
  let dbPromise = null;
  const memory = new Map();
  let usable = true;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { usable = false; resolve(null); };
        req.onblocked = () => { usable = false; resolve(null); };
      } catch (e) {
        usable = false;
        resolve(null);
      }
    });
    return dbPromise;
  }

  function request(db, mode, make) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = make(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  Lens.db = {
    async get(key) {
      const db = await open();
      if (!db) return memory.get(key);
      try { return await request(db, "readonly", (s) => s.get(key)); } catch (e) { return memory.get(key); }
    },
    async set(key, value) {
      memory.set(key, value);
      const db = await open();
      if (!db) return;
      try { await request(db, "readwrite", (s) => s.put(value, key)); } catch (e) {
        console.warn("[lens] IndexedDB write failed; keeping data in memory only", e);
      }
    },
    async del(key) {
      memory.delete(key);
      const db = await open();
      if (!db) return;
      try { await request(db, "readwrite", (s) => s.delete(key)); } catch (e) { /* ignore */ }
    },
    get persistent() { return usable; },
  };

  /** localStorage with try/catch: blocked storage must never break the page. */
  Lens.local = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
    del(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
})();
