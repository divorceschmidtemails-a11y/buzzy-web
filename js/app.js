// Decoy web UI. Session state lives only in memory: {pin, slot, data, blobs}.
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let S = null, idle, clipTimer, query = '';
const toast = (m, ms = 2000) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); };

// ---- auto-lock: 30s idle, or immediately when hidden ----
function lock() { S = null; clearTimeout(idle); pinScreen(); }
function bump() { if (!S) return; clearTimeout(idle); idle = setTimeout(lock, 30000); }
['pointerdown', 'keydown', 'input', 'scroll'].forEach(e => addEventListener(e, bump, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden && S) lock(); });

// ---- clipboard: best effort clear after 15s ----
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied, clears in 15s'); } catch { return toast('Copy failed'); }
  clearTimeout(clipTimer);
  clipTimer = setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 15000);
}

// ---- PIN pad ----
function pinPad(title, sub, onDone) {
  let v = '';
  app.innerHTML = `<h1>${esc(title)}</h1><p class="sub" id="sub">${sub}</p><div class="dots">${'<i></i>'.repeat(6)}</div>
  <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button class="blank"></button><button data-k="0">0</button><button data-k="del">⌫</button></div>`;
  const draw = () => app.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < v.length));
  app.querySelector('.pad').onclick = async e => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'del') v = v.slice(0, -1); else if (v.length < 6) v += k;
    draw(); if (v.length === 6) { const p = v; v = ''; await onDone(p, m => { $('#sub').innerHTML = m; draw(); }); }
  };
}

async function pinScreen() {
  const blobs = await DB.get('blobs');
  if (!blobs) return setup();
  pinPad('Decoy', 'Enter PIN', async (pin, msg) => {
    const st = (await DB.get('lock')) || {};
    const w = DecoyCore.lockWait(st);
    if (w) return msg(`<span class="err">Locked. Try again in ${Math.ceil(w / 60000)} min</span>`);
    msg('Unlocking…');
    const r = await DecoyCore.unlock(pin, blobs);
    if (!r) {
      const ns = DecoyCore.recordFail(st); await DB.set('lock', ns);
      return msg(`<span class="err">${ns.until ? `Wrong PIN. Locked for ${Math.round((ns.until - Date.now()) / 60000)} min` : `Wrong PIN (${5 - ns.fails} before lockout)`}</span>`);
    }
    await DB.set('lock', { fails: 0, until: 0 });
    S = { pin, slot: r.slot, data: r.data, blobs }; bump(); vault();
  });
}

function setup() {
  let real;
  pinPad('Set up Decoy', 'Choose your real 6-digit PIN', (p, msg) => {
    real = p;
    pinPad('Set up Decoy', 'Choose a different decoy PIN. It opens a fake vault.', async (d, msg2) => {
      if (d === real) return msg2('<span class="err">Must differ from the real PIN</span>');
      msg2('Encrypting… (this is slow on purpose)');
      await DB.set('blobs', await DecoyCore.createVaults(real, d)); await DB.set('lock', { fails: 0, until: 0 });
      toast('Vaults created'); pinScreen();
    });
  });
}

async function save() {
  S.blobs[S.slot] = await DecoyCore.seal(S.pin, S.data);
  await DB.set('blobs', S.blobs);
}

function vault() {
  const q = query.toLowerCase();
  const list = S.data.entries.filter(e => !q || [e.name, e.user, e.notes].join(' ').toLowerCase().includes(q));
  app.innerHTML = `<header><h2>Vault</h2><div class="row"><button class="btn ghost" id="more">Backup</button><button class="btn ghost" id="lock">Lock</button></div></header>
  <div class="stack"><input id="q" placeholder="Search" value="${esc(query)}"><button class="btn" id="add">+ New entry</button></div>
  <ul class="list">${list.map(e => `<li data-id="${e.id}">${esc(e.name)}<small>${esc(e.user)}</small></li>`).join('') || '<li><small>No entries</small></li>'}</ul>`;
  $('#q').oninput = e => { query = e.target.value; const pos = e.target.selectionStart; vault(); $('#q').focus(); $('#q').setSelectionRange(pos, pos); };
  $('#add').onclick = () => edit(); $('#lock').onclick = lock; $('#more').onclick = backup;
  app.querySelector('.list').onclick = e => { const li = e.target.closest('li[data-id]'); if (li) edit(S.data.entries.find(x => x.id === li.dataset.id)); };
}

function edit(entry) {
  const e = entry || { id: crypto.randomUUID(), name: '', user: '', pass: '', notes: '' };
  app.innerHTML = `<header><button class="btn ghost" id="back">Back</button><h2>${entry ? 'Entry' : 'New entry'}</h2><button class="btn" id="save">Save</button></header>
  <label>Coded name</label><input id="name" value="${esc(e.name)}">
  <label>Username</label><div class="row"><input id="user" value="${esc(e.user)}" autocapitalize="off"><button class="btn ghost" style="flex:0" id="cu">Copy</button></div>
  <label>Password</label><div class="row"><input id="pass" type="password" value="${esc(e.pass)}" autocapitalize="off"><button class="btn ghost" style="flex:0" id="show">Show</button><button class="btn ghost" style="flex:0" id="cp">Copy</button></div>
  <div class="row" style="margin-top:8px"><input id="len" type="number" min="8" max="64" value="20"><button class="btn ghost" id="gen">Generate</button></div>
  <label>Notes</label><textarea id="notes">${esc(e.notes)}</textarea>
  ${entry ? '<p><button class="btn ghost err" id="del">Delete entry</button></p>' : ''}`;
  $('#back').onclick = vault;
  $('#show').onclick = () => { const p = $('#pass'); p.type = p.type === 'password' ? 'text' : 'password'; };
  $('#cu').onclick = () => copy($('#user').value); $('#cp').onclick = () => copy($('#pass').value);
  $('#gen').onclick = () => { $('#pass').value = DecoyCore.genPassword(Math.min(64, Math.max(8, +$('#len').value || 20))); $('#pass').type = 'text'; };
  $('#save').onclick = async () => {
    Object.assign(e, { name: $('#name').value.trim() || 'Untitled', user: $('#user').value, pass: $('#pass').value, notes: $('#notes').value });
    if (!entry) S.data.entries.push(e);
    S.data.entries.sort((a, b) => a.name.localeCompare(b.name));
    try { await save(); toast('Saved'); vault(); } catch (x) { toast(x.message); }
  };
  if (entry) $('#del').onclick = async () => { if (!confirm('Delete this entry?')) return; S.data.entries = S.data.entries.filter(x => x !== entry); await save(); vault(); };
}

function backup() {
  app.innerHTML = `<header><button class="btn ghost" id="back">Back</button><h2>Backup</h2><span></span></header>
  <p class="sub">Backups use their own passphrase (8+ characters). They contain only the vault that is open now.</p>
  <label>Backup passphrase</label><input id="bp" type="password">
  <div class="stack"><button class="btn" id="exp">Export encrypted backup</button>
  <label>Restore (replaces this vault's entries)</label><input id="file" type="file" accept=".json,application/json"><button class="btn ghost" id="imp">Import backup</button></div>`;
  $('#back').onclick = vault;
  $('#exp').onclick = async () => {
    try {
      const txt = await DecoyCore.exportBackup($('#bp').value, S.data);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
      a.download = `decoy-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (x) { toast(x.message); }
  };
  $('#imp').onclick = async () => {
    const f = $('#file').files[0]; if (!f) return toast('Choose a file');
    try { const d = await DecoyCore.importBackup($('#bp').value, await f.text()); if (!Array.isArray(d.entries)) throw new Error('Not a Decoy backup');
      S.data = d; await save(); toast('Restored'); vault(); } catch (x) { toast(x.message); }
  };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
pinScreen();
