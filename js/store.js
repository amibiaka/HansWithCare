/* Dehna data layer.
   Two modes, one interface:
   - Demo mode (config.supabaseUrl empty): every collection lives in memory and localStorage on this device.
   - Cloud mode: the same local cache is the offline layer; writes go to an outbox that is flushed to Supabase
     (PostgREST upserts, idempotent by id), and a pull-sync merges server rows by updated_at. Row-level security
     on the server decides what each caller may read: patients are identified by a device token header,
     professionals and staff by a Supabase Auth session and their profile row. Attachments go to a private
     storage bucket. The views never talk to the network directly; they only use DB.* below.
   Ethiopia data residency (ToR §11) applies to the production host; Supabase is the pilot backend. */
const DB = (() => {
  const COLS = ['geo','emergency','facilities','practitioners','pharmacyProducts','hansProducts','wellbeing','kb','redFlags','users','cases','orders','consents','audit','complaints','notifications','approvals','flags','fees','translations','guideLog','profiles'];
  const SEEDED = ['geo','emergency','facilities','practitioners','pharmacyProducts','hansProducts','wellbeing','kb','redFlags','users','flags','fees'];
  const TABLE = { pharmacyProducts: 'pharmacy_products', hansProducts: 'hans_products', redFlags: 'red_flags', guideLog: 'guide_log' };
  const PUBLIC = ['geo','emergency','facilities','practitioners','pharmacyProducts','hansProducts','wellbeing','kb','redFlags'];
  const PRIVATE = ['cases','orders','consents','complaints','notifications','approvals','audit','guideLog','profiles'];
  const cache = {}; const listeners = []; let session = null;
  const CFG = window.DEHNA_CONFIG || {};

  const Local = {
    key: c => 'hwc.' + c,
    load(c) { try { const v = localStorage.getItem(this.key(c)); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    save(c, v) { try { localStorage.setItem(this.key(c), JSON.stringify(v)); return true; } catch (e) { console.warn('persist failed', c, e); return false; } },
    clear() { Object.keys(localStorage).filter(k => k.startsWith('hwc.') && k !== 'hwc.lang').forEach(k => localStorage.removeItem(k)); }
  };

  // ---------- Supabase REST (no SDK, keeps the shell small) ----------
  const Remote = {
    enabled: !!(CFG.supabaseUrl && CFG.supabaseAnonKey),
    url: (CFG.supabaseUrl || '').replace(/\/$/, ''),
    key: CFG.supabaseAnonKey || '',
    auth: null,            // { access_token, refresh_token, expires_at, user:{id,email} }
    lastSync: {},          // per table ISO timestamp
    syncing: false,
    table: c => TABLE[c] || c,
    loadAuth() { try { this.auth = JSON.parse(localStorage.getItem('hwc.auth') || 'null'); } catch (e) { this.auth = null; } },
    saveAuth() { try { if (this.auth) localStorage.setItem('hwc.auth', JSON.stringify(this.auth)); else localStorage.removeItem('hwc.auth'); } catch (e) {} },
    async token() {
      if (!this.auth) return null;
      if (this.auth.expires_at && this.auth.expires_at * 1000 - Date.now() < 60000) {
        try { const r = await fetch(this.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.auth.refresh_token }) }); if (r.ok) { const j = await r.json(); this.auth = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, user: j.user }; this.saveAuth(); } else if (r.status === 400 || r.status === 401) { this.auth = null; this.saveAuth(); session = null; emit('change'); return null; } } catch (e) { /* offline: keep using the old token */ }
      }
      return this.auth ? this.auth.access_token : null;
    },
    async headers(extra) {
      const tok = await this.token();
      const h = { apikey: this.key, 'Content-Type': 'application/json', 'x-device-token': deviceToken() };
      if (tok) h.Authorization = 'Bearer ' + tok; else if (/^eyJ/.test(this.key)) h.Authorization = 'Bearer ' + this.key; // legacy anon JWT; publishable keys need apikey only
      return Object.assign(h, extra || {});
    },
    async signIn(email, password) {
      const r = await fetch(this.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'auth');
      this.auth = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at, user: j.user }; this.saveAuth();
      const p = await this.get('profiles', 'user_id=eq.' + j.user.id); if (!p.length) { this.auth = null; this.saveAuth(); throw new Error('No profile for this account. Ask an administrator to assign a role.'); }
      return { id: j.user.id, role: p[0].role, name: p[0].name, linked: p[0].linked || null, email };
    },
    async signOut() { try { await fetch(this.url + '/auth/v1/logout', { method: 'POST', headers: await this.headers() }); } catch (e) {} this.auth = null; this.saveAuth(); },
    async get(table, query) { const out = []; let from = 0; for (;;) { const r = await fetch(this.url + '/rest/v1/' + table + '?' + (query || 'select=*'), { headers: await this.headers({ Range: from + '-' + (from + 999), 'Range-Unit': 'items' }) }); if (!r.ok) throw new Error(table + ' ' + r.status); const j = await r.json(); out.push.apply(out, j); if (j.length < 1000) break; from += 1000; } return out; },
    async upsert(table, rows) { const r = await fetch(this.url + '/rest/v1/' + table + '?on_conflict=id', { method: 'POST', headers: await this.headers({ Prefer: (table === 'audit' ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates') + ',return=minimal' }), body: JSON.stringify(rows) }); if (!r.ok) { const txt = await r.text(); const e = new Error(table + ' ' + r.status + ' ' + txt.slice(0, 200)); e.status = r.status; throw e; } },
    async del(table, id) { const r = await fetch(this.url + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: await this.headers() }); if (!r.ok && r.status !== 404) throw new Error(table + ' delete ' + r.status); },
    async upload(path, blob) { const r = await fetch(this.url + '/storage/v1/object/attachments/' + path, { method: 'POST', headers: await this.headers({ 'Content-Type': blob.type || 'application/octet-stream', 'x-upsert': 'true' }), body: blob }); if (!r.ok) throw new Error('upload ' + r.status); },
    async download(path) { const r = await fetch(this.url + '/storage/v1/object/authenticated/attachments/' + path, { headers: await this.headers() }); if (!r.ok) throw new Error('download ' + r.status); return r.blob(); },
    row(c, obj) { if (obj.__settings) return { id: obj.id, doc: obj.doc, updated_at: nowIso() }; return { id: obj.id, doc: obj, updated_at: obj.updatedAt || nowIso() }; },
    // Outbox: pending writes survive reloads and offline periods; flushed in order, idempotent upserts.
    outbox() { try { return JSON.parse(localStorage.getItem('hwc.outbox') || '[]'); } catch (e) { return []; } },
    setOutbox(o) { try { localStorage.setItem('hwc.outbox', JSON.stringify(o)); } catch (e) {} },
    queue(op, c, obj) { if (!this.enabled) return; const o = this.outbox().filter(x => !(x.c === c && x.id === (obj.id || obj) && x.op === op)); o.push({ op, c, id: obj.id || obj, doc: op === 'upsert' ? obj : null, tries: 0, at: nowIso() }); this.setOutbox(o); if (navigator.onLine) this.flush(); },
    flushing: false,
    async flush() {
      if (!this.enabled || this.flushing || !navigator.onLine) return; this.flushing = true;
      try {
        let o = this.outbox();
        while (o.length) {
          const it = o[0];
          try { if (it.op === 'upsert') await this.upsert(this.table(it.c), [this.row(it.c, it.doc)]); else await this.del(this.table(it.c), it.id); o.shift(); this.setOutbox(o); }
          catch (e) { it.tries++; if (e.status && e.status >= 400 && e.status < 500 && it.tries >= 3) { console.warn('dropping rejected write', it.c, it.id, e.message); audit('sync:rejected', it.id, { reason: (e.message || '').slice(0, 120) }); o.shift(); } else if (it.tries > 20) o.shift(); this.setOutbox(o); if (!(e.status >= 400 && e.status < 500)) break; }
        }
      } finally { this.flushing = false; }
    },
    async pull(cols) {
      let changed = 0;
      for (const c of cols) {
        const table = this.table(c); const since = this.lastSync[table];
        if (c === 'profiles') { if (!this.auth) continue; try { const rows = await this.get('profiles', 'select=*'); cache.profiles = rows.map(r => Object.assign({ id: r.user_id, updatedAt: r.created_at }, r)); Local.save('profiles', cache.profiles); } catch (e) {} continue; }
        let q = 'select=id,doc,updated_at&order=updated_at.asc' + (since ? '&updated_at=gt.' + encodeURIComponent(since) : '');
        let rows; try { rows = await this.get(table, q); } catch (e) { console.warn('pull', table, e.message); continue; }
        if (!rows.length) continue;
        const local = all(c); const idx = {}; local.forEach((x, i) => idx[x.id] = i);
        const pending = new Set(this.outbox().filter(x => x.c === c).map(x => x.id));
        rows.forEach(r => { const d = r.doc; d.updatedAt = r.updated_at; const i = idx[r.id]; if (pending.has(r.id)) return; if (i === undefined) { local.push(d); idx[r.id] = local.length - 1; changed++; } else if ((local[i].updatedAt || '') < r.updated_at) { local[i] = d; changed++; } });
        this.lastSync[table] = rows[rows.length - 1].updated_at;
        Local.save(c, local);
      }
      return changed;
    },
    async pullSettings() { try { const rows = await this.get('settings', 'select=id,doc,updated_at'); rows.forEach(r => { if (r.id === 'flags' || r.id === 'fees') { cache[r.id] = r.doc; Local.save(r.id, r.doc); } }); } catch (e) {} }
  };

  const idb = {
    db: null,
    open() { if (this.db) return Promise.resolve(this.db); return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open('hwc-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
    async put(id, blob, meta) { meta = meta || {}; await this.open().then(db => new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ blob, meta, at: Date.now() }, id); tx.oncomplete = () => res(id); tx.onerror = () => rej(tx.error); })); if (Remote.enabled && meta.path) { try { await Remote.upload(meta.path, blob); } catch (e) { console.warn('upload deferred', e.message); const q = idb.pendingUploads(); q.push({ id, path: meta.path }); idb.setPending(q); } } return id; },
    async get(id, path) { let r = await this.open().then(db => new Promise((res, rej) => { const q = db.transaction('files').objectStore('files').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); })).catch(() => null); if (!r && Remote.enabled && path) { try { const blob = await Remote.download(path); r = { blob, meta: { path }, at: Date.now() }; } catch (e) { r = null; } } return r; },
    del(id) { return this.open().then(db => new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); })); },
    clear() { return this.open().then(db => new Promise((res) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = () => res(); })).catch(() => {}); },
    pendingUploads() { try { return JSON.parse(localStorage.getItem('hwc.uploads') || '[]'); } catch (e) { return []; } },
    setPending(q) { try { localStorage.setItem('hwc.uploads', JSON.stringify(q)); } catch (e) {} },
    async flushUploads() { if (!Remote.enabled || !navigator.onLine) return; const q = this.pendingUploads(); const rest = []; for (const u of q) { const f = await this.get(u.id); if (!f) continue; try { await Remote.upload(u.path, f.blob); } catch (e) { rest.push(u); } } this.setPending(rest); }
  };

  function emit(kind) { listeners.forEach(fn => { try { fn(kind || 'change'); } catch (e) { console.error(e); } }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function nowIso() { return new Date().toISOString(); }

  function init() {
    const seededVersion = Local.load('seedVersion');
    COLS.forEach(c => {
      let v = Local.load(c);
      const reseed = v === null || (seededVersion !== SEED.version && SEEDED.includes(c));
      if (reseed) { v = SEED[c] !== undefined ? clone(SEED[c]) : (c === 'flags' || c === 'fees' ? {} : []); Local.save(c, v); }
      cache[c] = v;
    });
    Local.save('seedVersion', SEED.version);
    try { session = JSON.parse(sessionStorage.getItem('hwc.session') || 'null'); } catch (e) { session = null; }
    if (Remote.enabled) { Remote.loadAuth(); if (!Remote.auth) session = null; try { Remote.lastSync = JSON.parse(localStorage.getItem('hwc.lastSync') || '{}'); } catch (e) {} }
  }
  async function sync() {
    if (!Remote.enabled || Remote.syncing || !navigator.onLine) return 0; Remote.syncing = true;
    try {
      await Remote.flush(); await idb.flushUploads();
      const changed = await Remote.pull(PUBLIC.concat(PRIVATE));
      await Remote.pullSettings();
      try { localStorage.setItem('hwc.lastSync', JSON.stringify(Remote.lastSync)); } catch (e) {}
      if (changed) emit('sync');
      return changed;
    } finally { Remote.syncing = false; }
  }
  function all(c) { return cache[c] || (cache[c] = []); }
  function get(c, id) { return all(c).find(x => x.id === id) || null; }
  function put(c, obj) {
    const arr = all(c); const i = arr.findIndex(x => x.id === obj.id);
    obj.updatedAt = nowIso();
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    Local.save(c, arr); Remote.queue('upsert', c, obj); emit('change'); return obj;
  }
  function remove(c, id) { cache[c] = all(c).filter(x => x.id !== id); Local.save(c, cache[c]); Remote.queue('delete', c, id); emit('change'); }
  function setObj(c, obj) { cache[c] = obj; Local.save(c, obj); if (Remote.enabled && (c === 'flags' || c === 'fees')) Remote.queue('upsert', 'settings', { id: c, doc: obj, __settings: true }); emit('change'); }
  function newId(prefix) { return (prefix || 'ID') + '-' + Date.now().toString(36).toUpperCase().slice(-6) + Math.random().toString(36).slice(2, 5).toUpperCase(); }

  // Tamper-evident audit chain on the device; the server keeps its own chain via trigger (ToR §12)
  function audit(action, object, extra) {
    const arr = all('audit'); const prev = arr.length ? arr[arr.length - 1].hash : '0';
    const e = Object.assign({ id: newId('AU'), at: nowIso(), actor: session ? session.id : 'anonymous', role: session ? session.role : 'public', device: deviceToken(), action, object: object || '', prev }, extra || {});
    e.hash = hash(prev + JSON.stringify([e.at, e.actor, e.action, e.object, e.reason || '', e.result || '']));
    arr.push(e); if (arr.length > 2000) arr.splice(0, arr.length - 2000);
    Local.save('audit', arr); Remote.queue('upsert', 'audit', e); return e;
  }
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16).padStart(8, '0'); }

  function login(user) { session = { id: user.id, role: user.role, name: user.name, linked: user.linked || null, email: user.email || null, at: nowIso() }; try { sessionStorage.setItem('hwc.session', JSON.stringify(session)); } catch (e) {} audit('login', user.id); emit('change'); }
  async function loginRemote(email, password) { const u = await Remote.signIn(email, password); login(u); Remote.lastSync = {}; sync(); return u; }
  function logout() { if (session) audit('logout', session.id); session = null; try { sessionStorage.removeItem('hwc.session'); } catch (e) {} if (Remote.enabled) { Remote.signOut(); ['cases','orders','notifications','consents','complaints','approvals','audit','guideLog','profiles'].forEach(c => { cache[c] = all(c).filter(x => x.device === deviceToken()); Local.save(c, cache[c]); }); Remote.lastSync = {}; } emit('change'); }
  function getSession() { return session; }
  function flag(k) { const f = all('flags'); return f[k] !== false; }
  function setFlag(k, v) { const f = Object.assign({}, all('flags')); f[k] = v; setObj('flags', f); audit('flag', k, { result: String(v) }); }
  function deviceToken() { let tk = null; try { tk = localStorage.getItem('hwc.device'); if (!tk) { tk = newId('DEV'); localStorage.setItem('hwc.device', tk); } } catch (e) { tk = 'DEV-VOLATILE'; } return tk; }
  function notify(to, text, link) { put('notifications', { id: newId('NT'), to, text, link: link || '', at: nowIso(), read: false }); }
  function exportJSON() { const o = {}; COLS.forEach(c => o[c] = all(c)); o.exportedAt = nowIso(); o.seedVersion = SEED.version; return JSON.stringify(o, null, 2); }
  function toCSV(rows, cols) { const esc = v => { v = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }; cols = cols || Array.from(rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())); return [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n'); }
  function parseCSV(text) { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < text.length; i++) { const ch = text[i]; if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; } if (cell || row.length) { row.push(cell); rows.push(row); } if (!rows.length) return []; const head = rows[0]; return rows.slice(1).filter(r => r.some(x => x !== '')).map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i] !== undefined ? r[i] : ''); return o; }); }
  function reset() { Local.clear(); idb.clear(); try { sessionStorage.removeItem('hwc.session'); localStorage.removeItem('hwc.outbox'); localStorage.removeItem('hwc.lastSync'); } catch (e) {} location.reload(); }

  return { init, sync, all, get, put, remove, setObj, newId, nowIso, audit, login, loginRemote, logout, session: getSession, flag, setFlag, deviceToken, notify, exportJSON, toCSV, parseCSV, reset, files: idb, on: fn => listeners.push(fn), clone, hash, remote: Remote };
})();
