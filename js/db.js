// IndexedDB: store "kv" with keys 'blobs' ([Uint8Array, Uint8Array]) and 'lock' ({fails, until}).
const DB = (() => {
  let p; const db = () => p ||= new Promise((res, rej) => { const r = indexedDB.open('decoy', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv'));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), clear: () => tx('readwrite', s => s.clear()) };
})();
