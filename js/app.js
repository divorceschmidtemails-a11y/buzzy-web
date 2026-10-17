// Buzzy web UI (Decoy engine). Session state lives only in memory: {pin, slot, data, blobs}.
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let S = null, idle, clipTimer, query = '';
const { CODE_RE, nextCode, ensureCodes, safeUrl } = DecoyCore;
const shortcutLink = code => location.href.split('#')[0] + '#' + code;
const wantedCode = () => { const h = location.hash.slice(1); return CODE_RE.test(h) ? h : ''; };
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
  <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n => `<button data-k="${n}">${n}</button>`).join('')}<button class="blank"></button><button data-k="0">0</button><button data-k="del">⌫</button></div>${installTip()}`;
  const draw = () => app.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < v.length));
  app.querySelector('.pad').onclick = async e => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'del') v = v.slice(0, -1); else if (v.length < 6) v += k;
    draw(); if (v.length === 6) { const p = v; v = ''; await onDone(p, m => { $('#sub').innerHTML = m; draw(); }); }
  };
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const installTip = () => standalone() ? '' : `<p class="tip">Install Buzzy: in Safari tap Share → Add to Home Screen. On Android Chrome: ⋮ menu → Add to Home screen.</p>`;

async function pinScreen() {
  const blobs = await DB.get('blobs');
  if (!blobs) return setup();
  pinPad('Buzzy', 'Enter PIN', async (pin, msg) => {
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
    S = { pin, slot: r.slot, data: r.data, blobs }; bump();
    if (!Array.isArray(S.data.entries)) S.data.entries = [];
    if (ensureCodes(S.data.entries)) { try { await save(); } catch {} }
    const want = wantedCode(), hit = want && S.data.entries.find(x => x.code === want);
    if (want) history.replaceState(null, '', location.pathname + location.search);
    if (hit) edit(hit); else vault();
  });
}

function setup() {
  let real;
  pinPad('Set up Buzzy', 'Choose your real 6-digit PIN', (p, msg) => {
    real = p;
    pinPad('Set up Buzzy', 'Choose a different decoy PIN. It opens a fake vault.', async (d, msg2) => {
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
  const list = S.data.entries.filter(e => !q || [e.code, e.name, e.user, e.url, e.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  app.innerHTML = `<header><h2>Vault</h2><div class="row"><button class="btn ghost" id="more">Backup</button><button class="btn ghost" id="lock">Lock</button></div></header>
  <div class="stack"><input id="q" placeholder="Search (code, name, link…)" value="${esc(query)}" autocomplete="off" autocapitalize="off"><button class="btn" id="add">+ New entry</button></div>
  <ul class="list">${list.map(e => { const u = safeUrl(e.url);
    return `<li data-id="${esc(e.id)}"><span class="code">${esc(e.code)}</span> ${esc(e.name)}${u ? `<a class="link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : ''}<small>${esc(e.user)}</small></li>`; }).join('') || '<li><small>No entries</small></li>'}</ul>`;
  $('#q').oninput = e => { query = e.target.value; const pos = e.target.selectionStart; vault(); $('#q').focus(); $('#q').setSelectionRange(pos, pos); };
  $('#add').onclick = () => edit(); $('#lock').onclick = lock; $('#more').onclick = backup;
  app.querySelector('.list').onclick = e => { if (e.target.closest('a.link')) return; const li = e.target.closest('li[data-id]'); if (li) edit(S.data.entries.find(x => x.id === li.dataset.id)); };
}

function edit(entry) {
  // New entries always start blank: no prefill from sample data, the browser, or a previous entry.
  const e = entry || { id: crypto.randomUUID(), code: nextCode(new Set(S.data.entries.map(x => x.code))), name: '', url: '', user: '', pass: '', notes: '' };
  const val = v => entry ? esc(v) : '';
  app.innerHTML = `<header><button class="btn ghost" id="back">Back</button><h2><span class="code">${esc(e.code)}</span> ${entry ? 'Entry' : 'New entry'}</h2><button class="btn" id="save">Save</button></header>
  <form id="f" autocomplete="off">
  <label>Coded name</label><input id="name" value="${val(e.name)}" autocomplete="off">
  <label>Link (optional)</label><div class="row"><input id="url" type="url" inputmode="url" value="${val(e.url)}" placeholder="https://…" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn ghost nf" id="open">Open</button></div>
  <label>Username</label><div class="row"><input id="user" name="buzzy-u" value="${val(e.user)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true"><button class="btn ghost nf" id="cu">Copy</button></div>
  <label>Password</label><div class="row"><input id="pass" name="buzzy-p" type="password" value="${val(e.pass)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-1p-ignore data-lpignore="true"><button class="btn ghost nf" id="show">Show</button><button class="btn ghost nf" id="cp">Copy</button></div>
  <div class="row mt"><input id="len" type="number" min="8" max="64" value="20"><button class="btn ghost" id="gen">Generate</button></div>
  <label>Notes</label><textarea id="notes" autocomplete="off">${val(e.notes)}</textarea></form>
  ${entry ? `<label>Home-screen shortcut link</label><div class="row"><input id="sc" readonly value="${esc(shortcutLink(e.code))}"><button class="btn ghost nf" id="csc">Copy</button></div>
  <p class="tip">Open this link in Safari, then Share → Add to Home Screen. After you unlock, it jumps straight to ${esc(e.code)}.</p>` : ''}
  ${entry ? '<p><button class="btn ghost err" id="del">Delete entry</button></p>' : ''}`;
  $('#back').onclick = vault; $('#f').onsubmit = ev => ev.preventDefault();
  if (!entry) { $('#user').value = ''; $('#pass').value = ''; setTimeout(() => { if (!$('#user')) return; if (!$('#user').dataset.typed) $('#user').value = ''; if (!$('#pass').dataset.typed) $('#pass').value = ''; }, 300);
    ['user', 'pass'].forEach(id => $('#' + id).addEventListener('input', ev => ev.target.dataset.typed = '1')); }
  $('#open').onclick = () => { const u = safeUrl($('#url').value); if (!u) return toast('Enter an http(s) link'); window.open(u, '_blank', 'noopener,noreferrer'); };
  if (entry) $('#csc').onclick = () => copy($('#sc').value);
  $('#show').onclick = () => { const p = $('#pass'); p.type = p.type === 'password' ? 'text' : 'password'; };
  $('#cu').onclick = () => copy($('#user').value); $('#cp').onclick = () => copy($('#pass').value);
  $('#gen').onclick = () => { $('#pass').value = DecoyCore.genPassword(Math.min(64, Math.max(8, +$('#len').value || 20))); $('#pass').type = 'text'; };
  $('#save').onclick = async () => {
    const rawUrl = $('#url').value.trim(), url = safeUrl(rawUrl);
    if (rawUrl && !url) return toast('Link must be http(s)');
    Object.assign(e, { name: $('#name').value.trim() || 'Untitled', url, user: $('#user').value, pass: $('#pass').value, notes: $('#notes').value });
    if (!entry) S.data.entries.push(e);
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
      a.download = `buzzy-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (x) { toast(x.message); }
  };
  $('#imp').onclick = async () => {
    const f = $('#file').files[0]; if (!f) return toast('Choose a file');
    try { const d = await DecoyCore.importBackup($('#bp').value, await f.text()); if (!Array.isArray(d.entries)) throw new Error('Not a Buzzy backup');
      ensureCodes(d.entries); S.data = d; await save(); toast('Restored'); vault(); } catch (x) { toast(x.message); }
  };
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
pinScreen();
