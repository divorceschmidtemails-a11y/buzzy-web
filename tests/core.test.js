const test = require('node:test'), assert = require('node:assert');
const C = require('../js/core.js'); const IT = 1000; // fast iterations for most tests
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));

test('default is PBKDF2 600k; real-iteration seal/open round trip', async () => {
  assert.strictEqual(C.ITER, 600000);
  const b = await C.seal('123456', { entries: [{ name: 'x' }] });
  assert.deepStrictEqual(await C.open('123456', b), { entries: [{ name: 'x' }] });
  assert.strictEqual(await C.open('654321', b), null);
});
test('blobs are fixed size and differ each seal (random salt/iv)', async () => {
  const a = await C.seal('111111', { entries: [] }, IT), b = await C.seal('111111', { entries: [] }, IT);
  assert.strictEqual(a.length, C.BLOB); assert.strictEqual(b.length, C.BLOB); assert.ok(!eq(a, b));
  const big = await C.seal('111111', { entries: Array.from({ length: 300 }, (_, i) => ({ name: 'n' + i, notes: 'x'.repeat(200) })) }, IT);
  assert.strictEqual(big.length, C.BLOB);
});
test('tampered blob fails to open', async () => {
  const b = await C.seal('222222', { entries: [] }, IT); b[5000] ^= 1;
  assert.strictEqual(await C.open('222222', b, IT), null);
});
test('decoy separation: each PIN opens only its own vault, equal sizes, no marker', async () => {
  const blobs = await C.createVaults('123456', '999999', IT);
  assert.strictEqual(blobs.length, 2); assert.strictEqual(blobs[0].length, blobs[1].length);
  const r = await C.unlock('123456', blobs, IT), d = await C.unlock('999999', blobs, IT);
  assert.ok(r && d); assert.notStrictEqual(r.slot, d.slot);
  r.data.entries.push({ name: 'bank', pass: 'secret' });
  blobs[r.slot] = await C.seal('123456', r.data, IT);
  assert.deepStrictEqual((await C.unlock('999999', blobs, IT)).data.entries, []);
  assert.strictEqual((await C.unlock('123456', blobs, IT)).data.entries[0].pass, 'secret');
  assert.strictEqual(await C.unlock('000000', blobs, IT), null);
  await assert.rejects(C.createVaults('123456', '123456', IT)); await assert.rejects(C.createVaults('12345', '999999', IT));
});
test('real vault lands in both slots across runs (random placement)', async () => {
  const slots = new Set();
  for (let i = 0; i < 30 && slots.size < 2; i++) slots.add((await C.unlock('123456', await C.createVaults('123456', '999999', 1), 1)).slot);
  assert.strictEqual(slots.size, 2);
});
test('lockout: 4 free tries, then 1/5/15/60 min, persists in state', () => {
  let s = {}, t = 1e12; const waits = [];
  for (let i = 0; i < 9; i++) { s = C.recordFail(s, t); waits.push((s.until ? s.until - t : 0) / 60000); }
  assert.deepStrictEqual(waits, [0, 0, 0, 0, 1, 5, 15, 60, 60]);
  s = JSON.parse(JSON.stringify(s)); // survives serialization
  assert.strictEqual(C.lockWait(s, t), 3600000); assert.strictEqual(C.lockWait(s, t + 3600001), 0);
});
test('password generator', () => {
  const p = C.genPassword(32); assert.strictEqual(p.length, 32);
  assert.match(C.genPassword(50, '1'), /^[2-9]{50}$/); assert.notStrictEqual(C.genPassword(), C.genPassword());
});
test('backup export/import with separate passphrase', async () => {
  const data = { entries: [{ name: 'a', user: 'u', pass: 'p', notes: 'n' }] };
  const txt = await C.exportBackup('correct horse', data, IT);
  assert.ok(!txt.includes('"p"'));
  assert.deepStrictEqual(await C.importBackup('correct horse', txt), data);
  await assert.rejects(C.importBackup('wrong pass!', txt)); await assert.rejects(C.exportBackup('short', data));
});
