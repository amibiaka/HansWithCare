/* Practitioner, pharmacy and wellbeing dashboards (ToR §6 practitioner/pharmacy/wellbeing, §7 workflows) */
const PRO = (() => {
  const { esc, $, $$ } = UI;
  const ROLE_KEY = { doctor: 'role_doctor', nurse: 'role_nurse', pharmacist: 'role_pharmacist', wellbeing: 'role_wellbeing', admin: 'role_admin', verifier: 'role_verifier', safety: 'role_safety', privacy: 'role_admin', finance: 'role_admin' };

  function signin() {
    if (DB.remote && DB.remote.enabled) return signinCloud();
    const users = DB.all('users');
    UI.render('<h1>' + esc(t('pro_signin')) + '</h1><p class="small muted">' + esc(t('pro_signin_hint')) + '</p><div class="card"><label class="f">' + esc(t('pro_sign_as')) + '<select id="sUser">' + users.map(u => '<option value="' + u.id + '">' + esc(u.name) + ' · ' + esc(t(ROLE_KEY[u.role])) + (u.pin ? ' (PIN)' : '') + '</option>').join('') + '</select></label><label class="f" id="pinRow" hidden>' + esc(t('pro_pin')) + '<input type="password" id="sPin" inputmode="numeric" maxlength="4"></label><button class="btn primary block" id="sGo">' + esc(t('pro_signin')) + '</button><p class="err" id="sErr"></p></div><p class="hint">MFA, device binding and licence-linked accounts replace this demonstration sign-in in production (ToR §5).</p>', { back: true, title: t('pro_signin') });
    const sel = $('#sUser'); const upd = () => { const u = users.find(x => x.id === sel.value); $('#pinRow').hidden = !(u && u.pin); }; sel.onchange = upd; upd();
    $('#sGo').onclick = () => { const u = users.find(x => x.id === sel.value); if (u.pin && $('#sPin').value !== u.pin) { $('#sErr').textContent = t('adm_wrong_pin'); DB.audit('login:failed', u.id); return; } DB.login(u); UI.go(u.pin ? '#/admin' : '#/pro'); };
  }
  function signinCloud() {
    UI.render('<h1>' + esc(t('pro_signin')) + '</h1><p class="small muted">' + esc(t('pro_signin_hint')) + '</p><div class="card"><label class="f">Email<input type="email" id="sEmail" autocomplete="username" inputmode="email"></label><label class="f">Password<input type="password" id="sPw" autocomplete="current-password"></label><button class="btn primary block" id="sGo">' + esc(t('pro_signin')) + '</button><p class="err" id="sErr"></p></div><p class="hint">Accounts are created by a Dehna administrator after licence verification. Production adds MFA and device binding (ToR §5).</p>', { back: true, title: t('pro_signin') });
    const go = async () => { const b = $('#sGo'); b.disabled = true; $('#sErr').textContent = ''; try { const u = await DB.loginRemote($('#sEmail').value.trim(), $('#sPw').value); UI.go(['admin','verifier','safety','privacy','finance'].includes(u.role) ? '#/admin' : '#/pro'); } catch (e) { $('#sErr').textContent = e.message; b.disabled = false; } };
    $('#sGo').onclick = go; $('#sPw').onkeydown = e => { if (e.key === 'Enter') go(); };
  }
  function requireRole(roles) { const s = DB.session(); if (!s || (roles && !roles.includes(s.role))) { UI.go('#/pro/signin'); return null; } return s; }

  function dashboard() {
    const s = DB.session(); if (!s) return signin();
    if (['admin','verifier','safety','privacy','finance'].includes(s.role)) return UI.go('#/admin');
    if (s.role === 'pharmacist') return pharmacy(s);
    if (s.role === 'wellbeing') return wellbeing(s);
    return practitioner(s);
  }
  function notifs(to) { return DB.all('notifications').filter(n => n.to === to && !n.read).sort((a, b) => b.at.localeCompare(a.at)); }
  function notifBox(to) { const n = notifs(to); return n.length ? '<div class="alert blue small"><b>' + n.length + '</b> · ' + n.slice(0, 3).map(x => '<a href="' + x.link + '">' + esc(x.text) + '</a>').join(' · ') + ' <button class="linkbtn" id="nClear">' + esc(t('close')) + '</button></div>' : ''; }
  function bindNotif(to) { const b = $('#nClear'); if (b) b.onclick = () => { DB.all('notifications').filter(n => n.to === to).forEach(n => { n.read = true; DB.put('notifications', n); }); dashboard(); }; }
  function head(s, extra) { return '<div class="row between"><div><h1 style="margin:0">' + esc(s.name) + '</h1><span class="badge b-pink">' + esc(t(ROLE_KEY[s.role])) + '</span> ' + (extra || '') + '</div><button class="btn ghost small" id="pOut">' + esc(t('signout')) + '</button></div>'; }
  function bindHead() { const b = $('#pOut'); if (b) b.onclick = () => { DB.logout(); UI.go('#/'); }; }
  function caseRow(c, lang) {
    const age = UI.ago(c.createdAt); const stale = (Date.now() - new Date(c.createdAt)) > 24 * 3600e3 && /received|submitted/.test(c.state);
    return '<a class="item" href="#/pro/case/' + c.id + '" style="text-decoration:none;color:inherit"><div class="body"><div class="row between"><span class="title">' + (c.redFlag || c.urgency === 'urgent' ? '<span class="badge b-red">' + esc(c.redFlag ? t('red_flag') : t('urg_urgent')) + '</span> ' : '') + esc(c.id) + ' · ' + esc(t(c.type === 'prescription' ? 'rx_title' : 'need_' + (c.need || 'other'))) + '</span>' + UI.stateBadge(c.state) + '</div><div class="meta">' + esc(t('request_age')) + ' ' + esc(age) + ' · ' + esc(t('patient_lang')) + ' ' + esc((c.lang || 'en').toUpperCase()) + ' · ' + esc(c.location && c.location.adminUnit ? GEO.path(c.location.adminUnit, lang) : '-') + (c.location && c.location.granularity === 'area' ? ' (' + esc(t('share_location_area')) + ')' : '') + (stale ? ' · <span class="err">' + esc(t('pro_stale')) + '</span>' : '') + '</div></div></a>';
  }

  // ---------- Practitioner (PRO-01..04) ----------
  function practitioner(s) {
    const p = DB.get('practitioners', s.linked); const lang = getLang();
    const q = DB.all('cases').filter(c => c.recipient && c.recipient.id === p.id && !/closed|cancelled|expired/.test(c.state)).sort((a, b) => (b.redFlag ? 1 : 0) - (a.redFlag ? 1 : 0) || (b.urgency === 'urgent' ? 1 : 0) - (a.urgency === 'urgent' ? 1 : 0) || a.createdAt.localeCompare(b.createdAt));
    const done = DB.all('cases').filter(c => c.recipient && c.recipient.id === p.id && /closed|cancelled|expired|completed/.test(c.state)).length;
    const exp = UI.daysUntil(p.licence.expiry);
    UI.render(head(s, UI.verifBadge(p.verification)) + notifBox(p.id) + (exp !== null && exp < 60 ? '<div class="alert amber small"><b>' + esc(t('pro_expiring')) + '</b> · ' + esc(p.licence.expiry) + ' (' + exp + ' d)</div>' : '') +
      '<div class="kpis"><div class="kpi"><div class="n">' + q.length + '</div><div class="l">' + esc(t('pro_queue')) + '</div></div><div class="kpi"><div class="n">' + q.filter(c => c.redFlag || c.urgency === 'urgent').length + '</div><div class="l">' + esc(t('urg_urgent')) + '</div></div><div class="kpi"><div class="n">' + done + '</div><div class="l">' + esc(t('st_closed')) + '</div></div></div>' +
      '<div class="card"><h3>' + esc(t('pro_availability')) + '</h3><div class="choices">' + ['available_now','by_appointment','home_visit','on_leave','offline_mode'].map(a => '<button class="choice" data-av="' + a + '" aria-pressed="' + (p.availability === a) + '">' + esc(t(a)) + '</button>').join('') + '</div></div>' +
      '<h2>' + esc(t('pro_queue')) + '</h2><div class="card">' + (q.length ? q.map(c => caseRow(c, lang)).join('') : '<p class="muted">' + esc(t('pro_no_items')) + '</p>') + '</div>' +
      '<div class="card"><h3>' + esc(t('pro_profile')) + '</h3><table class="tbl"><tr><th>' + esc(t('licence')) + '</th><td>' + esc(p.licence.no) + ' · ' + esc(p.licence.issuer) + ' · ' + esc(p.licence.status) + ' · ' + esc(t('expires')) + ' ' + esc(p.licence.expiry) + '</td></tr><tr><th>' + esc(t('scope')) + '</th><td>' + p.scope.map(x => esc(t('need_' + x))).join(', ') + '</td></tr><tr><th>' + esc(t('service_mode')) + '</th><td>' + p.modes.map(m => esc(t(m))).join(', ') + '</td></tr><tr><th>' + esc(t('service_area')) + '</th><td>' + esc(p.serviceArea) + '</td></tr><tr><th>' + esc(t('last_verified')) + '</th><td>' + esc(UI.fmtDate(p.verification.verifiedAt)) + ' · ' + esc(p.verification.by || '') + '</td></tr></table><a class="btn ghost small" href="#/p/practitioner/' + p.id + '">' + esc(t('view_profile')) + '</a></div>', { title: t('pro_queue') });
    bindHead(); bindNotif(p.id);
    $$('[data-av]').forEach(b => b.onclick = () => { p.availability = b.getAttribute('data-av'); DB.put('practitioners', p); DB.audit('availability', p.id, { result: p.availability }); practitioner(s); });
  }
  async function proCase(id) {
    const s = requireRole(); if (!s) return; const c = DB.get('cases', id); if (!c) return UI.go('#/pro'); const lang = getLang();
    const isPh = s.role === 'pharmacist'; const me = s.linked;
    const allowed = isPh ? (c.recipients || []).includes(me) || c.chosenPharmacy === me : (c.recipient && c.recipient.id === me) || (c.referral && c.referral.to === me);
    if (!allowed) { UI.render('<div class="alert red">Access denied: this case is not assigned to you.</div>'); DB.audit('case:denied', id); return; }
    DB.audit('case:read', id);
    const p = isPh ? null : DB.get('practitioners', me); const inScope = isPh || !c.need || c.need === 'other' || c.need === 'emergency_record' || p.scope.includes(c.need);
    const open = !/closed|cancelled|expired|completed/.test(c.state);
    const consentedLoc = c.location ? (c.location.granularity === 'exact' && c.location.lat != null ? GEO.path(c.location.adminUnit, lang) + ' · GPS ' + c.location.lat.toFixed(4) + ',' + c.location.lng.toFixed(4) + (c.location.landmark ? ' · ' + c.location.landmark : '') : GEO.path(c.location.adminUnit, lang) + (c.location.landmark ? ' · ' + c.location.landmark : '')) : '-';
    UI.render('<div class="card"><div class="row between"><h1 style="margin:0">' + esc(c.id) + '</h1>' + UI.stateBadge(c.state) + '</div>' + (c.redFlag ? '<div class="alert red"><b>' + esc(t('red_flag')) + '</b>: patient text matched an emergency rule. Confirm the patient has called emergency services.</div>' : '') +
      '<table class="tbl"><tr><th>' + esc(t('type')) + '</th><td>' + esc(t(c.type === 'prescription' ? 'rx_title' : 'need_' + (c.need || 'other'))) + ' · ' + esc(t('urg_' + (c.urgency || 'routine'))) + (c.appt ? ' · ' + esc(t('request_appt')) : '') + '</td></tr><tr><th>' + esc(t('patient_lang')) + '</th><td>' + esc((c.lang || 'en').toUpperCase()) + ' · ' + esc(c.channel || 'web') + '</td></tr><tr><th>' + esc(t('phone')) + '</th><td>' + (c.state === 'received' || c.state === 'submitted' ? '<span class="muted">' + esc(t('pro_accept')) + ' → ' + esc(t('phone')) + '</span>' : '<a href="' + UI.telHref(c.phone) + '">' + esc(c.phone) + '</a>' + (c.name ? ' · ' + esc(c.name) : '')) + '</td></tr><tr><th>' + esc(t('location_title')) + '</th><td>' + esc(consentedLoc) + '</td></tr><tr><th>' + esc(t('req_describe')) + '</th><td>' + esc(c.text || '-') + '</td></tr><tr><th>' + esc(t('date')) + '</th><td>' + esc(UI.fmtDate(c.createdAt, true)) + ' · ' + esc(t('request_age')) + ' ' + esc(UI.ago(c.createdAt)) + '</td></tr>' + (c.fulfilment ? '<tr><th>' + esc(t('rx_fulfil')) + '</th><td>' + esc(t(c.fulfilment)) + '</td></tr>' : '') + '</table>' +
      (c.attachments && c.attachments.length ? '<h3>' + esc(t('case_attachments')) + '</h3>' + c.attachments.map(a => '<div class="small" id="att-' + a.id + '">' + esc(a.kind) + ' · ' + UI.fmtBytes(a.size) + '</div>').join('') : '') +
      (!inScope ? '<div class="alert amber"><b>' + esc(t('pro_scope_block')) + '</b> · ' + esc(t('pro_refer')) + '</div>' : '') +
      (c.referral ? '<div class="alert blue small"><b>' + esc(t('st_referred')) + '</b> → ' + esc(c.referral.toName) + ' · ' + esc(c.referral.reason || '') + ' · consent: ' + esc(c.referral.consent || 'pending') + '</div>' : '') +
      '<h3>' + esc(t('case_timeline')) + '</h3>' + PATIENT.timeline(c) + '</div>' +
      (isPh ? rxPanel(c, me, open) : proPanel(c, p, inScope, open)) +
      '<div class="card"><h3>' + esc(t('case_messages')) + '</h3><div class="chat">' + (c.messages || []).map(m => '<div class="msg ' + (m.from === 'patient' ? 'ai' : 'me') + '"><div class="who">' + esc(m.from === 'patient' ? 'Patient' : m.by || 'Me') + ' · ' + esc(UI.fmtDate(m.at, true)) + '</div>' + esc(m.text) + (m.attachment ? '<div id="att-' + m.attachment + '"></div>' : '') + '</div>').join('') + '</div>' + (open ? '<textarea id="pReply" placeholder="' + esc(t('pro_reply')) + '"></textarea><p class="hint" id="aiNote" hidden>' + esc(t('pro_ai_review')) + '</p><div class="row"><button class="btn primary" id="pSend">' + esc(t('send')) + '</button>' + (!isPh && DB.flag('guide') ? '<button class="btn ghost" id="pDraft">' + esc(t('pro_ai_draft')) + '</button>' : '') + '</div><h4>' + esc(t('req_voice')) + '</h4><div id="pRec"></div>' : '') + '</div>', { back: true, title: c.id });
    for (const a of (c.attachments || [])) { try { const f = await DB.files.get(a.id, a.path); const el = $('#att-' + a.id); if (f && el) { const url = URL.createObjectURL(f.blob); el.innerHTML += f.blob.type.startsWith('audio') ? '<audio controls src="' + url + '"></audio>' : f.blob.type === 'application/pdf' ? '<a href="' + url + '" target="_blank">PDF</a>' : '<img src="' + url + '" alt="" style="max-height:260px;border-radius:8px">'; DB.audit('attachment:read', a.id); } } catch (e) {} }
    for (const m of (c.messages || [])) { if (m.attachment) { try { const f = await DB.files.get(m.attachment, m.attachmentPath); const el = $('#att-' + m.attachment); if (f && el) el.innerHTML = '<audio controls src="' + URL.createObjectURL(f.blob) + '"></audio>'; } catch (e) {} } }
    let voiceReply = null; if (open) UI.recorder('pRec', r => voiceReply = r);
    const send = $('#pSend'); if (send) send.onclick = async () => { const v = $('#pReply').value.trim(); if (!v && !voiceReply) return; let att = null; if (voiceReply) { att = DB.newId('AT'); try { await DB.files.put(att, voiceReply.blob, { case: c.id, kind: 'voice-reply', path: c.id + '/' + att }); } catch (e) { att = null; } } c.messages.push({ from: 'pro', by: s.name, text: v, at: DB.nowIso(), attachment: att, attachmentPath: att ? c.id + '/' + att : null }); if (c.state === 'received') CASES.transition(c, 'under_review', s.id); DB.put('cases', c); DB.audit('case:message', c.id); proCase(id); };
    const dr = $('#pDraft'); if (dr) dr.onclick = () => { $('#pReply').value = GUIDE.draftForPractitioner(c); $('#aiNote').hidden = false; DB.audit('ai:draft', c.id, { result: GUIDE.VERSION }); };
    // actions
    const act = (to, note) => { CASES.transition(c, to, s.id, note); if (c.device) DB.notify(c.device, 'Update on ' + c.id, '#/case/' + c.id); proCase(id); };
    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
    on('#aAccept', () => act('accepted'));
    on('#aReview', () => act('under_review'));
    on('#aDecline', () => reason(t('pro_decline'), r => { c.messages.push({ from: 'pro', by: s.name, text: t('pro_decline') + ': ' + r, at: DB.nowIso() }); act('closed', r); }));
    on('#aClarify', () => reason(t('pro_clarify'), r => { c.messages.push({ from: 'pro', by: s.name, text: r, at: DB.nowIso() }); act('clarification_requested', r); }));
    on('#aSchedule', () => UI.modal('<h2>' + esc(t('pro_schedule')) + '</h2><input type="datetime-local" id="schAt" class="in"><div class="row" style="margin-top:8px"><button class="btn primary" id="schOk">' + esc(t('ok')) + '</button><button class="btn ghost" data-close>' + esc(t('cancel')) + '</button></div>', (el, close) => { $('#schOk', el).onclick = () => { const v = $('#schAt', el).value; if (!v) return; close(); c.scheduledAt = v; c.messages.push({ from: 'pro', by: s.name, text: t('st_scheduled') + ': ' + v.replace('T', ' '), at: DB.nowIso() }); if (c.state !== 'accepted') CASES.transition(c, 'accepted', s.id); act('scheduled', v); }; }));
    on('#aComplete', () => act('completed'));
    on('#aClose', () => reason(t('pro_close'), r => act('closed', r)));
    on('#aRefer', () => refer(c, s));
    on('#aAcceptRef', () => { c.recipient = { kind: 'practitioner', id: me, name: s.name }; c.referral.accepted = DB.nowIso(); DB.put('cases', c); DB.audit('referral:accept', c.id); act('received', 'referral accepted'); });
    // pharmacy responses
    $$('[data-rx]').forEach(b => b.onclick = () => { const st = b.getAttribute('data-rx'); UI.modal('<h2>' + esc(b.textContent) + '</h2><label class="f">' + esc(t('notes')) + '<textarea id="rxNote"></textarea></label>' + (st === 'full' || st === 'partial' ? '<label class="f">' + esc(t('prep_time')) + '<input type="text" id="rxPrep" placeholder="e.g. 30 min / today 17:00"></label>' : '') + '<div class="row" style="margin-top:8px"><button class="btn primary" id="rxOk">' + esc(t('send')) + '</button><button class="btn ghost" data-close>' + esc(t('cancel')) + '</button></div>', (el, close) => { $('#rxOk', el).onclick = () => { c.responses = c.responses || {}; c.responses[me] = { status: st, note: $('#rxNote', el).value.trim(), prepTime: st === 'full' || st === 'partial' ? $('#rxPrep', el).value.trim() : '', at: DB.nowIso(), by: s.name }; if (c.state === 'received') CASES.transition(c, 'under_review', s.id, 'pharmacy responded'); DB.put('cases', c); DB.audit('rx:respond', c.id, { result: st }); DB.notify(c.device, 'Pharmacy response on ' + c.id, '#/case/' + c.id); close(); proCase(id); }; }); });
  }
  function reason(title, cb) { UI.modal('<h2>' + esc(title) + '</h2><label class="f">' + esc(t('pro_reason')) + '<textarea id="rsn"></textarea></label><div class="row"><button class="btn primary" id="rsnOk">' + esc(t('ok')) + '</button><button class="btn ghost" data-close>' + esc(t('cancel')) + '</button></div>', (el, close) => { $('#rsnOk', el).onclick = () => { const v = $('#rsn', el).value.trim(); if (!v) return; close(); cb(v); }; }); }
  function proPanel(c, p, inScope, open) {
    if (!open) return '';
    const st = c.state; const b = (id, key, cls) => '<button class="btn ' + (cls || 'ghost') + ' small" id="' + id + '">' + esc(t(key)) + '</button>';
    if (c.referral && c.referral.to === p.id && c.referral.consent === 'approved' && !c.referral.accepted) return '<div class="card"><div class="alert blue">' + esc(t('pro_transfer_consent')) + '</div>' + b('aAcceptRef', 'pro_accept', 'primary') + '</div>';
    let out = '<div class="card"><div class="row">';
    if (inScope && CASES.can('request', st, 'accepted')) out += b('aAccept', 'pro_accept', 'success');
    if (CASES.can('request', st, 'clarification_requested')) out += b('aClarify', 'pro_clarify');
    if (inScope && (st === 'accepted' || CASES.can('request', st, 'accepted'))) out += b('aSchedule', 'pro_schedule');
    if (CASES.can('request', st, 'referred')) out += b('aRefer', 'pro_refer');
    if (CASES.can('request', st, 'completed')) out += b('aComplete', 'st_completed', 'success');
    if (CASES.can('request', st, 'closed')) out += b('aDecline', 'pro_decline', 'danger');
    if (st === 'completed') out += b('aClose', 'pro_close');
    return out + '</div></div>';
  }
  function rxPanel(c, me, open) {
    if (!open) return '';
    const r = (c.responses || {})[me];
    return '<div class="card"><h3>' + esc(t('pro_rx_requests')) + '</h3>' + (r ? '<p><span class="badge b-blue">' + esc(t('rx_' + (r.status === 'unavailable' ? 'unavail' : r.status))) + '</span> ' + esc(r.note || '') + ' · ' + esc(UI.fmtDate(r.at, true)) + '</p>' : '') + (c.chosenPharmacy === me ? '<div class="alert green small">' + esc(t('rx_choose_pharmacy')) + ' ✓ · <a href="#/pro/order/' + esc(c.orderId || '') + '">' + esc(t('pro_orders')) + '</a></div>' : '') + '<p class="hint">' + esc(t('rx_note_valid')) + '</p><div class="row">' + [['full','rx_full','success'],['partial','rx_partial',''],['unavailable','rx_unavail','danger'],['clarify','rx_clarify',''],['refer','rx_refer','']].map(x => '<button class="btn ' + (x[2] || 'ghost') + ' small" data-rx="' + x[0] + '">' + esc(t(x[1])) + '</button>').join('') + '</div></div>';
  }
  function refer(c, s) {
    const lang = getLang(); const me = s.linked;
    const cands = DB.all('practitioners').filter(p => p.id !== me && p.verification.state === 'verified' && p.availability !== 'on_leave' && p.availability !== 'offline_mode').map(p => ({ p, d: GEO.km(DB.get('practitioners', me), p) })).sort((a, b) => ((c.need && a.p.scope.includes(c.need)) ? 0 : 1) - ((c.need && b.p.scope.includes(c.need)) ? 0 : 1) || (a.d || 9e9) - (b.d || 9e9));
    UI.modal('<h2>' + esc(t('pro_refer_to')) + '</h2><p class="small">' + esc(t('pro_transfer_consent')) + '</p><select id="refTo" class="in">' + cands.map(x => '<option value="' + x.p.id + '">' + esc(x.p.name) + ' · ' + esc(x.p.specialty) + (x.d != null ? ' · ' + x.d.toFixed(0) + ' km' : '') + (c.need && x.p.scope.includes(c.need) ? ' ✓' : '') + '</option>').join('') + '</select><label class="f">' + esc(t('pro_reason')) + '<textarea id="refWhy"></textarea></label><div class="row"><button class="btn primary" id="refOk">' + esc(t('pro_refer')) + '</button><button class="btn ghost" data-close>' + esc(t('cancel')) + '</button></div>', (el, close) => { $('#refOk', el).onclick = () => { const to = DB.get('practitioners', $('#refTo', el).value); const why = $('#refWhy', el).value.trim(); if (!to || !why) return; close(); c.referral = { from: me, to: to.id, toName: to.name, by: s.name, at: DB.nowIso(), reason: why, consent: null, accepted: null }; c.messages.push({ from: 'pro', by: s.name, text: t('pro_refer') + ' → ' + to.name + ': ' + why, at: DB.nowIso() }); CASES.transition(c, 'referred', s.id, to.name); DB.notify(c.device, 'Referral consent needed for ' + c.id, '#/case/' + c.id); proCase(c.id); }; });
  }

  // ---------- Pharmacy (PHA-01..05) ----------
  function pharmacy(s) {
    const f = DB.get('facilities', s.linked); const lang = getLang(); const tab = UI.qs().tab || 'rx';
    const rxs = DB.all('cases').filter(c => c.type === 'prescription' && (c.recipients || []).includes(f.id) && !/closed|cancelled|expired|completed/.test(c.state)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const orders = DB.all('orders').filter(o => o.seller === f.id && !/delivered|cancelled|refunded/.test(o.state));
    const prods = DB.all('pharmacyProducts').filter(p => p.pharmacy === f.id);
    const stale = prods.filter(p => (Date.now() - new Date(p.updatedAt)) > 72 * 3600e3 && p.stock !== 'not_stocked');
    UI.render(head(s, UI.verifBadge(f.verification) + ' <span class="muted small">' + esc(f.name) + '</span>') + notifBox(f.id) +
      '<div class="kpis"><div class="kpi"><div class="n">' + rxs.length + '</div><div class="l">' + esc(t('pro_rx_requests')) + '</div></div><div class="kpi"><div class="n">' + orders.length + '</div><div class="l">' + esc(t('pro_orders')) + '</div></div><div class="kpi"><div class="n">' + stale.length + '</div><div class="l">' + esc(t('pro_stale')) + '</div></div></div>' +
      '<div class="tabs">' + [['rx','pro_rx_requests'],['orders','pro_orders'],['stock','pro_stock']].map(x => '<button data-tab="' + x[0] + '" aria-selected="' + (tab === x[0]) + '">' + esc(t(x[1])) + '</button>').join('') + '</div>' +
      (tab === 'rx' ? '<div class="card">' + (rxs.length ? rxs.map(c => caseRow(c, lang)).join('') : '<p class="muted">' + esc(t('pro_no_items')) + '</p>') + '</div>' : '') +
      (tab === 'orders' ? '<div class="card">' + (orders.length ? orders.map(o => orderRow(o)).join('') : '<p class="muted">' + esc(t('pro_no_items')) + '</p>') + '</div>' : '') +
      (tab === 'stock' ? '<div class="card">' + (stale.length ? '<div class="alert amber small">' + stale.length + ' ' + esc(t('pro_stale')) + ' → ' + esc(t('stock_confirm')) + '</div>' : '') + '<div class="row"><input type="search" id="sq" class="in" style="flex:1" placeholder="' + esc(t('search')) + '"><button class="btn small" id="sAdd">+ ' + esc(t('pro_new_product')) + '</button></div><div id="stockList">' + prods.map(stockRow).join('') + '</div><p class="hint">' + esc(t('rx_note_valid')) + '</p></div>' : ''), { title: f.name });
    bindHead(); bindNotif(f.id);
    $$('[data-tab]').forEach(b => b.onclick = () => UI.go('#/pro?tab=' + b.getAttribute('data-tab')));
    bindOrders();
    const sq = $('#sq'); if (sq) sq.oninput = () => { $('#stockList').innerHTML = prods.filter(p => (p.generic + ' ' + p.category).toLowerCase().includes(sq.value.toLowerCase())).map(stockRow).join(''); bindStock(); };
    bindStock();
    const sa = $('#sAdd'); if (sa) sa.onclick = () => editProduct({ id: DB.newId('PP'), pharmacy: f.id, generic: '', brand: '', strength: '', form: '', pack: '', rx: 'otc', category: '', price: 0, stock: 'available', expectedDate: '' }, s);
  }
  function stockRow(p) { const stale = (Date.now() - new Date(p.updatedAt)) > 72 * 3600e3; return '<div class="item"><div class="body"><div class="row between"><span class="title">' + esc(p.generic) + ' <span class="badge ' + (p.rx === 'pom' ? 'b-red' : 'b-grey') + '">' + (p.rx === 'pom' ? 'Rx' : p.rx === 'otc' ? 'OTC' : 'Retail') + '</span></span>' + UI.stockBadge(p.stock) + '</div><div class="meta">' + esc([p.strength, p.form, p.pack ? 'x' + p.pack : ''].filter(Boolean).join(' · ')) + ' · ' + p.price + ' ETB · ' + esc(t('pro_updated')) + ' ' + esc(UI.ago(p.updatedAt)) + (stale ? ' <span class="err">' + esc(t('pro_stale')) + '</span>' : '') + '</div><div class="row" style="margin-top:6px"><select data-stock="' + p.id + '" class="in" style="max-width:220px;min-height:40px">' + ['available','limited','unavailable','expected','requires_confirmation','not_stocked'].map(sv => '<option value="' + sv + '"' + (p.stock === sv ? ' selected' : '') + '>' + esc(t('stock_' + { requires_confirmation: 'confirm', not_stocked: 'not' }[sv] || sv)) + '</option>').join('') + '</select><button class="btn ghost small" data-edit="' + p.id + '">' + esc(t('edit')) + '</button></div></div></div>'; }
  function bindStock() {
    $$('[data-stock]').forEach(sel => sel.onchange = () => { const p = DB.get('pharmacyProducts', sel.getAttribute('data-stock')); p.stock = sel.value; p.updatedAt = DB.nowIso(); DB.put('pharmacyProducts', p); DB.audit('stock', p.id, { result: p.stock }); UI.toast(t('pro_updated')); dashboard(); });
    $$('[data-edit]').forEach(b => b.onclick = () => editProduct(DB.get('pharmacyProducts', b.getAttribute('data-edit')), DB.session()));
  }
  function editProduct(p, s) {
    UI.modal('<h2>' + esc(t('pro_products')) + '</h2>' + [['generic','Generic name'],['brand','Brand'],['strength','Strength'],['form','Dosage form'],['pack','Pack size'],['category',t('category')],['price',t('price') + ' (ETB)'],['expectedDate',t('stock_expected')]].map(x => '<label class="f">' + esc(x[1]) + '<input type="' + (x[0] === 'price' ? 'number' : x[0] === 'expectedDate' ? 'date' : 'text') + '" id="pf_' + x[0] + '" value="' + esc(p[x[0]]) + '"></label>').join('') + '<label class="f">' + esc(t('type')) + '<select id="pf_rx"><option value="otc"' + (p.rx === 'otc' ? ' selected' : '') + '>OTC</option><option value="pom"' + (p.rx === 'pom' ? ' selected' : '') + '>Prescription only (Rx)</option><option value="retail"' + (p.rx === 'retail' ? ' selected' : '') + '>Retail (non-medical)</option></select></label><div class="row" style="margin-top:8px"><button class="btn primary" id="pfOk">' + esc(t('save')) + '</button><button class="btn ghost" data-close>' + esc(t('cancel')) + '</button></div>', (el, close) => { $('#pfOk', el).onclick = () => { ['generic','brand','strength','form','pack','category','expectedDate','rx'].forEach(k => p[k] = $('#pf_' + k, el).value.trim()); p.price = +$('#pf_price', el).value || 0; if (!p.generic) return; p.updatedAt = DB.nowIso(); DB.put('pharmacyProducts', p); DB.audit('product:save', p.id); close(); dashboard(); }; });
  }
  function orderRow(o) { const next = { pending_confirmation: ['confirmed','cancelled'], confirmed: ['preparing','cancelled'], preparing: [o.fulfilment === 'deliver' ? 'assigned_for_delivery' : 'ready_for_collection','cancelled'], ready_for_collection: ['delivered'], assigned_for_delivery: ['delivered'] }[o.state] || []; return '<div class="item"><div class="body"><div class="row between"><span class="title"><a href="#/pro/order/' + o.id + '">' + esc(o.id) + '</a> · ' + o.items.map(i => esc(i.name) + (i.label ? ' ' + esc(i.label) : '') + ' ×' + i.qty).join(', ') + '</span>' + UI.stateBadge(o.state, 'order') + '</div><div class="meta">' + esc(UI.fmtDate(o.createdAt, true)) + ' · ' + esc(t(o.fulfilment === 'deliver' ? 'deliver' : 'collect')) + (o.when ? ' · ' + esc(o.when.replace('T', ' ')) : '') + ' · ' + (o.total ? o.total + ' ETB' : '') + (o.state !== 'pending_confirmation' ? ' · <a href="' + UI.telHref(o.buyer.phone) + '">' + esc(o.buyer.phone) + '</a>' + (o.address ? ' · ' + esc(o.address) : '') : '') + '</div><div class="row" style="margin-top:6px">' + next.map(n => '<button class="btn small ' + (n === 'cancelled' ? 'ghost' : n === 'delivered' ? 'success' : '') + '" data-ord="' + o.id + '" data-to="' + n + '">' + esc(t('os_' + n.replace('pending_confirmation', 'pending').replace('ready_for_collection', 'ready').replace('assigned_for_delivery', 'assigned'))) + '</button>').join('') + '</div></div></div>'; }
  function bindOrders() { $$('[data-ord]').forEach(b => b.onclick = () => { const o = DB.get('orders', b.getAttribute('data-ord')); const to = b.getAttribute('data-to'); const go = note => { CASES.transition(o, to, DB.session().id, note, 'order'); if (to === 'confirmed') o.addressReleased = true; DB.put('orders', o); DB.notify(o.device, 'Order ' + o.id + ': ' + t('os_' + to.replace('pending_confirmation', 'pending').replace('ready_for_collection', 'ready').replace('assigned_for_delivery', 'assigned')), '#/order/' + o.id); dashboard(); }; if (to === 'cancelled') reason(t('cancel'), go); else go(''); }); }
  function proOrder(id) { const s = requireRole(); if (!s) return; const o = DB.get('orders', id); if (!o) return UI.go('#/pro'); if (o.seller !== s.linked && !(o.seller === 'HANS' && s.role === 'admin')) return UI.render('<div class="alert red">Access denied.</div>'); UI.render(head(s) + '<div class="card">' + orderRow(o) + '<h3>' + esc(t('case_timeline')) + '</h3>' + PATIENT.timeline(o, 'order') + '</div>', { back: true, title: o.id }); bindHead(); bindOrders(); }

  // ---------- Wellbeing provider (WEL-01/02) ----------
  function wellbeing(s) {
    const w = DB.get('wellbeing', s.linked);
    const bk = DB.all('orders').filter(o => o.seller === w.id && !/delivered|cancelled|refunded/.test(o.state)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    UI.render(head(s, UI.verifBadge(w.verification) + ' <span class="badge b-pink">' + esc(t('wel_label')) + '</span>') + notifBox(w.id) + '<div class="alert pink small">' + esc(t('wel_note')) + '</div>' +
      '<div class="card"><h3>' + esc(t('pro_availability')) + '</h3><div class="choices">' + ['available_now','by_appointment','on_leave'].map(a => '<button class="choice" data-av="' + a + '" aria-pressed="' + (w.availability === a) + '">' + esc(t(a)) + '</button>').join('') + '</div></div>' +
      '<h2>' + esc(t('pro_bookings')) + '</h2><div class="card">' + (bk.length ? bk.map(orderRow).join('') : '<p class="muted">' + esc(t('pro_no_items')) + '</p>') + '</div><p class="hint">' + esc(t('wel_safeguards')) + ': ' + esc(w.safeguards) + '</p>', { title: w.name });
    bindHead(); bindNotif(w.id); bindOrders();
    $$('[data-av]').forEach(b => b.onclick = () => { w.availability = b.getAttribute('data-av'); DB.put('wellbeing', w); wellbeing(s); });
  }
  return { signin, dashboard, proCase, proOrder, orderRow, bindOrders, requireRole, head, bindHead, reason };
})();
