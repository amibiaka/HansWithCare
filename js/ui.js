/* UI helpers: rendering, routing, modal/toast, area picker, badges, listen (TTS), attachments, voice recorder */
const UI = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const main = () => document.getElementById('main');

  function render(html, opts) {
    const m = main(); m.innerHTML = html; m.focus({ preventScroll: true }); window.scrollTo(0, 0);
    document.getElementById('btnBack').hidden = !(opts && opts.back);
    if (opts && opts.title) document.title = opts.title + " · Dehna";
    $$('[data-i18n]', m).forEach(el => el.textContent = t(el.getAttribute('data-i18n')));
    return m;
  }
  function toast(msg, ms) { const el = document.getElementById('toast'); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => el.hidden = true, ms || 2600); }
  function modal(html, onOpen) {
    const el = document.getElementById('modal'); el.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>'; el.hidden = false;
    const close = () => { el.hidden = true; el.innerHTML = ''; };
    el.onclick = e => { if (e.target === el) close(); };
    $$('[data-close]', el).forEach(b => b.onclick = close);
    const f = $('button, input, select, textarea', el); if (f) f.focus();
    if (onOpen) onOpen(el, close);
    return close;
  }
  function closeModal() { const el = document.getElementById('modal'); el.hidden = true; el.innerHTML = ''; }
  function confirm(msg, cb) { modal('<p>' + esc(msg) + '</p><div class="row"><button class="btn danger" id="cOk">' + esc(t('confirm')) + '</button><button class="btn ghost" data-close>' + esc(t('cancel')) + '</button></div>', (el, close) => { $('#cOk', el).onclick = () => { close(); cb(); }; }); }

  function fmtDate(iso, withTime) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return iso; const o = { year: 'numeric', month: 'short', day: 'numeric' }; if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; } try { return d.toLocaleString(getLang() === 'am' || getLang() === 'ti' ? 'en-GB' : getLang(), o); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); } }
  function ago(iso) { const m = Math.round((Date.now() - new Date(iso)) / 60000); if (m < 1) return 'now'; if (m < 60) return m + ' min'; const h = Math.round(m / 60); if (h < 48) return h + ' h'; return Math.round(h / 24) + ' d'; }
  function daysUntil(iso) { if (!iso) return null; return Math.round((new Date(iso) - Date.now()) / 86400000); }

  function verifBadge(v) {
    const s = v && v.state;
    if (s === 'verified') { const d = v.expiry ? daysUntil(v.expiry) : null; return '<span class="badge b-green">✓ ' + esc(t('verified')) + '</span>'; }
    if (s === 'pending' || s === 'more_evidence') return '<span class="badge b-amber">' + esc(t('pending_verif')) + '</span>';
    if (s === 'expiring') return '<span class="badge b-amber">' + esc(t('pro_expiring')) + '</span>';
    return '<span class="badge b-grey">' + esc(t('unverified')) + '</span>';
  }
  function stateBadge(state, kind) {
    const key = (kind === 'order' ? 'os_' : 'st_') + state.replace('queued_offline', 'queued').replace('pending_confirmation', 'pending').replace('payment_pending', 'paypending').replace('ready_for_collection', 'ready').replace('assigned_for_delivery', 'assigned').replace('under_review', 'review').replace('clarification_requested', 'clarify');
    const cls = /completed|delivered|paid|accepted|confirmed/.test(state) ? 'b-green' : /cancel|expired|closed|refunded|disputed/.test(state) ? 'b-grey' : /queued|clarif|pending/.test(state) ? 'b-amber' : 'b-blue';
    return '<span class="badge ' + cls + '">' + esc(t(key)) + '</span>';
  }
  function stockBadge(s) { const map = { available: 'b-green', limited: 'b-amber', unavailable: 'b-red', expected: 'b-blue', requires_confirmation: 'b-amber', not_stocked: 'b-grey' }; return '<span class="badge ' + (map[s] || 'b-grey') + '">' + esc(t('stock_' + { requires_confirmation: 'confirm', not_stocked: 'not' }[s] || s)) + '</span>'; }
  function langNames(codes) { return (codes || []).map(c => { const l = LANGS.find(x => x.code === c); return l ? l.native : c; }).join(', '); }
  function telHref(n) { return 'tel:' + String(n || '').replace(/[^+\d]/g, ''); }

  // Listen (TTS) where the browser has a voice; hidden otherwise. Pre-recorded audio replaces this in production (ToR §13).
  function listenBtn(text) { if (!('speechSynthesis' in window)) return ''; return '<button class="btn ghost small" data-say="' + esc(text) + '" aria-label="' + esc(t('listen')) + '">🔊 ' + esc(t('listen')) + '</button>'; }
  function bindListen(root) { $$('[data-say]', root || document).forEach(b => b.onclick = () => { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(b.getAttribute('data-say')); u.lang = { am: 'am-ET', ti: 'ti-ET', om: 'om-ET', so: 'so-SO', fr: 'fr-FR', en: 'en-GB' }[getLang()] || 'en'; speechSynthesis.speak(u); } catch (e) {} }); }

  // Area picker: cascading selects down the flexible hierarchy. Emits the deepest selected id.
  function areaPicker(id, initial, onChange) {
    const lang = getLang();
    const html = '<div class="stack" id="' + id + '"></div>';
    setTimeout(() => build(initial), 0);
    function build(sel) {
      const box = document.getElementById(id); if (!box) return;
      const chain = sel ? GEO.ancestors(sel).map(u => u.id).concat([sel]).filter(x => x !== 'ET') : [];
      let parent = 'ET', out = '';
      for (let depth = 0; depth < 7; depth++) {
        const kids = GEO.children(parent); if (!kids.length) break;
        const cur = chain[depth] || '';
        const lvl = kids[0].level; const lname = lvl === 1 ? t('region') : lvl === 6 ? t('kebele') : lvl === 4 ? t('zone') : lvl === 2 ? t('zone') : t('woreda');
        out += '<label class="f">' + esc(lname) + '<select data-depth="' + depth + '"><option value="">' + esc(t('any_area')) + '</option>' + kids.sort((a, b) => a.name.localeCompare(b.name)).map(k => '<option value="' + k.id + '"' + (k.id === cur ? ' selected' : '') + '>' + esc(GEO.label(k, lang)) + '</option>').join('') + '</select></label>';
        if (!cur) break; parent = cur;
      }
      box.innerHTML = out;
      $$('select', box).forEach(s => s.onchange = () => { const v = s.value; const d = +s.getAttribute('data-depth'); const nv = v || (d > 0 ? chain[d - 1] : ''); build(nv); onChange(nv || null); });
    }
    return html;
  }

  // File attach with size/type validation, image downscale, metadata stripping via canvas re-encode (ToR §9 media rules)
  function readFile(file, maxBytes) {
    return new Promise((res, rej) => {
      if (!file) return rej(new Error('nofile'));
      const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
      if (!okTypes.includes(file.type) && !file.type.startsWith('image/')) return rej(new Error('type'));
      if (file.type.startsWith('image/')) {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => { const max = 1400; let w = img.width, h = img.height; if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); } const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url); c.toBlob(b => { if (!b) return rej(new Error('encode')); if (b.size > maxBytes) return rej(new Error('size')); res({ blob: b, type: 'image/jpeg', name: file.name, size: b.size }); }, 'image/jpeg', 0.82); };
        img.onerror = () => rej(new Error('decode')); img.src = url;
      } else { if (file.size > maxBytes) return rej(new Error('size')); res({ blob: file, type: file.type, name: file.name, size: file.size }); }
    });
  }
  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }

  // Voice recorder (MediaRecorder, Opus where available). Consent, playback, re-record, delete-before-send.
  function recorder(container, onDone) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!navigator.mediaDevices || !window.MediaRecorder) { el.innerHTML = '<p class="muted">' + esc(t('voice_no_mic')) + '</p>'; return; }
    let rec = null, chunks = [], timer = null, secs = 0, stream = null;
    const draw = state => {
      if (state === 'idle') el.innerHTML = '<div class="rec"><button class="btn primary" id="rStart">🎙 ' + esc(t('voice_record')) + '</button><span class="muted small">' + esc(t('voice_max')) + '</span></div>';
      if (state === 'rec') el.innerHTML = '<div class="rec"><span class="dot" aria-hidden="true"></span><span id="rTime">0 s</span><button class="btn danger" id="rStop">■ ' + esc(t('voice_stop')) + '</button></div>';
      if (state === 'done') el.innerHTML = '<div class="stack"><audio controls id="rAudio"></audio><div class="row"><span class="muted small" id="rSize"></span><button class="btn ghost small" id="rAgain">' + esc(t('voice_rerecord')) + '</button><button class="btn ghost small" id="rDel">' + esc(t('voice_delete')) + '</button></div></div>';
    };
    const start = async () => {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { el.innerHTML = '<p class="err">' + esc(t('voice_no_mic')) + '</p>'; return; }
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) || '';
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined); chunks = []; secs = 0;
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach(tr => tr.stop()); const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); draw('done'); const a = $('#rAudio', el); a.src = URL.createObjectURL(blob); $('#rSize', el).textContent = t('voice_size') + ': ' + fmtBytes(blob.size) + ' · ' + secs + ' s'; $('#rAgain', el).onclick = () => { onDone(null); draw('idle'); bind(); }; $('#rDel', el).onclick = () => { onDone(null); draw('idle'); bind(); }; onDone({ blob, type: blob.type, name: 'voice-note', size: blob.size, secs }); };
      rec.start(); draw('rec');
      timer = setInterval(() => { secs++; const tEl = $('#rTime', el); if (tEl) tEl.textContent = secs + ' s'; if (secs >= 60) stop(); }, 1000);
      $('#rStop', el).onclick = stop;
    };
    const stop = () => { clearInterval(timer); if (rec && rec.state !== 'inactive') rec.stop(); };
    const bind = () => { const b = $('#rStart', el); if (b) b.onclick = start; };
    draw('idle'); bind();
    return { stop };
  }

  function share(text, title) { if (navigator.share) return navigator.share({ title: title || "Han's With Care", text }).catch(() => {}); return copy(text); }
  function copy(text) { return (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(t('copied'))).catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(t('copied')); } catch (e) {} ta.remove(); }); }
  function download(name, text, type) { const b = new Blob([text], { type: type || 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function qs() { const h = location.hash.split('?')[1] || ''; const o = {}; h.split('&').filter(Boolean).forEach(p => { const [k, v] = p.split('='); o[decodeURIComponent(k)] = decodeURIComponent(v || ''); }); return o; }
  function go(hash) { location.hash = hash; }

  return { esc, $, $$, render, toast, modal, closeModal, confirm, fmtDate, ago, daysUntil, verifBadge, stateBadge, stockBadge, langNames, telHref, listenBtn, bindListen, areaPicker, readFile, fmtBytes, recorder, share, copy, download, qs, go };
})();
