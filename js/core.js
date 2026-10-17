// Decoy core: crypto, vault blobs, lockout. Works in browsers and Node 20 (globalThis.crypto).
(function (root) {
  const C = globalThis.crypto, S = C.subtle, enc = new TextEncoder(), dec = new TextDecoder();
  const ITER = 600000, BLOB = 262144; // every vault blob is exactly 256 KiB
  const SALT = 16, IV = 12, TAG = 16, PLAIN = BLOB - SALT - IV - TAG;
  const WAITS = [1, 5, 15, 60]; // minutes, after 4 free tries
  const rnd = n => { const u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) C.getRandomValues(u.subarray(i, Math.min(n, i + 65536))); return u; };
  async function deriveKey(pin, salt, iter = ITER) {
    const base = await S.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function pad(obj) {
    const j = enc.encode(JSON.stringify(obj));
    if (j.length + 4 > PLAIN) throw new Error('Vault full');
    const p = rnd(PLAIN); new DataView(p.buffer).setUint32(0, j.length); p.set(j, 4); return p;
  }
  function unpad(p) { const n = new DataView(p.buffer, p.byteOffset).getUint32(0); return JSON.parse(dec.decode(p.subarray(4, 4 + n))); }
  async function seal(pin, obj, iter) {
    const salt = rnd(SALT), iv = rnd(IV), key = await deriveKey(pin, salt, iter);
    const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv }, key, pad(obj)));
    const out = new Uint8Array(BLOB); out.set(salt); out.set(iv, SALT); out.set(ct, SALT + IV); return out;
  }
  async function open(pin, blob, iter) {
    try {
      const key = await deriveKey(pin, blob.subarray(0, SALT), iter);
      return unpad(new Uint8Array(await S.decrypt({ name: 'AES-GCM', iv: blob.subarray(SALT, SALT + IV) }, key, blob.subarray(SALT + IV))));
    } catch { return null; }
  }
  // Create both vaults; real one placed in a random slot. Nothing records which is which.
  async function createVaults(realPin, decoyPin, iter) {
    if (!/^\d{6}$/.test(realPin) || !/^\d{6}$/.test(decoyPin)) throw new Error('PINs must be 6 digits');
    if (realPin === decoyPin) throw new Error('PINs must differ');
    const a = await seal(realPin, { entries: [] }, iter), b = await seal(decoyPin, { entries: [] }, iter);
    return rnd(1)[0] & 1 ? [a, b] : [b, a];
  }
  // Try both slots (always both, so timing doesn't reveal the slot). Returns {slot, data} or null.
  async function unlock(pin, blobs, iter) {
    const r = await Promise.all(blobs.map(b => open(pin, b, iter)));
    const i = r.findIndex(x => x); return i < 0 ? null : { slot: i, data: r[i] };
  }
  // Lockout state: {fails, until}
  function lockWait(state, now = Date.now()) { return Math.max(0, (state.until || 0) - now); }
  function recordFail(state, now = Date.now()) {
    const fails = (state.fails || 0) + 1;
    const until = fails >= 5 ? now + WAITS[Math.min(fails - 5, 3)] * 60000 : 0;
    return { fails, until };
  }
  function genPassword(len = 20, sets = 'aA1!') {
    let cs = ''; if (sets.includes('a')) cs += 'abcdefghijkmnopqrstuvwxyz'; if (sets.includes('A')) cs += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    if (sets.includes('1')) cs += '23456789'; if (sets.includes('!')) cs += '!@#$%^&*-_=+?';
    const out = []; const lim = 256 - (256 % cs.length);
    while (out.length < len) for (const b of rnd(len * 2)) if (b < lim && out.length < len) out.push(cs[b % cs.length]);
    return out.join('');
  }
  // Backup: encrypted with its own passphrase. Format: base64(JSON{v,iter,salt,iv,ct})
  const b64 = u => btoa(String.fromCharCode(...u)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function exportBackup(pass, data, iter = ITER) {
    if (!pass || pass.length < 8) throw new Error('Passphrase must be 8+ characters');
    const salt = rnd(SALT), iv = rnd(IV), key = await deriveKey(pass, salt, iter);
    const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
    let s = ''; for (let i = 0; i < ct.length; i += 8192) s += String.fromCharCode(...ct.subarray(i, i + 8192));
    return JSON.stringify({ v: 1, app: 'decoy', iter, salt: b64(salt), iv: b64(iv), ct: btoa(s) });
  }
  async function importBackup(pass, text) {
    const o = JSON.parse(text); const key = await deriveKey(pass, unb64(o.salt), o.iter);
    try { return JSON.parse(dec.decode(await S.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)))); }
    catch { throw new Error('Wrong passphrase or damaged backup'); }
  }
  // Four-digit entry codes (0001..9999). Stable: existing valid, unique codes are kept; others get the next free one.
  const CODE_RE = /^\d{4}$/;
  function nextCode(used) { for (let i = 1; i <= 9999; i++) { const c = String(i).padStart(4, '0'); if (!used.has(c)) return c; } throw new Error('No free codes left'); }
  function ensureCodes(entries) {
    const seen = new Set(), bad = [];
    for (const e of entries) { if (CODE_RE.test(e.code || '') && !seen.has(e.code)) seen.add(e.code); else bad.push(e); }
    for (const e of bad) { e.code = nextCode(seen); seen.add(e.code); }
    return bad.length > 0;
  }
  // Only http(s) links are allowed (blocks javascript:, data:, etc.). Bare domains get https://.
  function safeUrl(u) { u = String(u || '').trim(); if (!u) return ''; if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }
  const api = { CODE_RE, nextCode, ensureCodes, safeUrl, ITER, BLOB, WAITS, deriveKey, seal, open, createVaults, unlock, lockWait, recordFail, genPassword, exportBackup, importBackup };
  if (typeof module !== 'undefined') module.exports = api; else root.DecoyCore = api;
})(this);
