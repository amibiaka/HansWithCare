/* Self-registration for health professionals and partners (ToR §5 identity rules, §6 verification).
   A registered professional is created in state "pending": visible in search with a pending label, not requestable,
   and only listed as verified after two administrators approve the licence check. In cloud mode the account is a
   Supabase Auth user, the record carries ownerUid, and a server-side trigger prevents self-verification. */
const REG = (() => {
  const { esc, $, $$ } = UI;
  const R = { step: 0, role: '', d: {}, doc: null };
  const NEEDS = ['general','maternal','child','chronic','mental','srh','medication'];
  const MODES = ['phone_audio','secure_chat','by_appointment','home_visit','video'];

  function view() {
    const lang = getLang(); const d = R.d;
    const steps = ['reg_role','reg_details','reg_doc','reg_account'];
    const head = '<h1>' + esc(t('reg_title')) + '</h1><p class="muted small">' + esc(t('home_pro_sub')) + '</p><div class="tabs" aria-hidden="true">' + steps.map((s, i) => '<button tabindex="-1" aria-selected="' + (i === R.step) + '">' + (i + 1) + '</button>').join('') + '</div>';
    let body = '';
    if (R.step === 0) body = '<div class="card"><h2>' + esc(t('reg_role')) + '</h2><div class="choices">' + [['doctor','reg_role_doctor'],['nurse','reg_role_nurse'],['pharmacy','reg_role_pharmacy'],['wellbeing','reg_role_wellbeing']].map(x => '<button class="choice" data-role="' + x[0] + '" aria-pressed="' + (R.role === x[0]) + '">' + esc(t(x[1])) + '</button>').join('') + '</div></div>';
    if (R.step === 1) {
      const f = (id, label, type, extra) => '<label class="f">' + esc(label) + '<input type="' + (type || 'text') + '" id="rg_' + id + '" value="' + esc(d[id] || '') + '"' + (extra || '') + '></label>';
      const pro = R.role === 'doctor' || R.role === 'nurse';
      body = '<div class="card"><h2>' + esc(t('reg_details')) + '</h2>' +
        (R.role === 'pharmacy' ? f('name', t('reg_business')) + f('responsiblePharmacist', t('reg_resp_pharm')) : f('name', t('reg_fullname'))) +
        (R.role === 'doctor' ? f('specialty', t('reg_specialty')) : '') +
        (R.role === 'nurse' ? '<label class="f">' + esc(t('reg_profession')) + '<select id="rg_profession"><option value="nurse"' + (d.profession === 'nurse' ? ' selected' : '') + '>' + esc(t('role_nurse')) + '</option><option value="midwife"' + (d.profession === 'midwife' ? ' selected' : '') + '>Midwife</option><option value="allied"' + (d.profession === 'allied' ? ' selected' : '') + '>Allied health professional</option></select></label>' : '') +
        (R.role === 'wellbeing' ? f('service', t('reg_service')) + f('price', t('reg_price')) : '') +
        (R.role !== 'wellbeing' ? f('licenceNo', t('reg_licence_no')) + f('issuer', t('reg_issuer'), 'text', ' placeholder="MOH HRL / regional health bureau / EFDA"') + f('expiry', t('reg_expiry'), 'date') : f('licenceNo', t('reg_licence_no') + ' (' + esc(t('optional')) + ')')) +
        (pro ? f('facilityName', t('reg_facility')) : '') +
        (R.role === 'pharmacy' ? f('hours', t('reg_hours'), 'text', ' placeholder="Mon-Sat 08:00-20:00"') + '<label class="check"><input type="checkbox" id="rg_delivery"' + (d.delivery ? ' checked' : '') + '><span>' + esc(t('reg_delivery')) + '</span></label>' : '') +
        (pro ? '<h3>' + esc(t('scope')) + '</h3><div class="grid2">' + NEEDS.map(n => '<label class="check"><input type="checkbox" data-scope="' + n + '"' + ((d.scope || []).includes(n) ? ' checked' : '') + '><span>' + esc(t('need_' + n)) + '</span></label>').join('') + '</div><h3>' + esc(t('reg_modes')) + '</h3><div class="grid2">' + MODES.map(m => '<label class="check"><input type="checkbox" data-mode="' + m + '"' + ((d.modes || []).includes(m) ? ' checked' : '') + '><span>' + esc(t(m)) + '</span></label>').join('') + '</div>' : '') +
        (R.role !== 'pharmacy' ? '<label class="f">' + esc(t('gender')) + '<select id="rg_gender"><option value="f"' + (d.gender === 'f' ? ' selected' : '') + '>' + esc(t('gender_f')) + '</option><option value="m"' + (d.gender === 'm' ? ' selected' : '') + '>' + esc(t('gender_m')) + '</option></select></label>' : '') +
        '<h3>' + esc(t('reg_languages')) + '</h3><div class="grid2">' + LANGS.map(l => '<label class="check"><input type="checkbox" data-lang-cb="' + l.code + '"' + ((d.languages || [lang]).includes(l.code) ? ' checked' : '') + '><span>' + esc(l.native) + '</span></label>').join('') + '</div>' +
        '<h3>' + esc(t('service_area')) + '</h3>' + UI.areaPicker('rgArea', d.adminUnit, v => { d.adminUnit = v; }) + f('serviceArea', t('reg_area_text')) +
        f('phone', t('phone'), 'tel') + '</div>';
    }
    if (R.step === 2) body = '<div class="card"><h2>' + esc(t('reg_doc')) + '</h2><p class="hint">' + esc(t('reg_doc_hint')) + '</p><input type="file" id="rg_doc" accept="image/*,application/pdf" capture="environment"><div id="rgDocInfo" style="margin-top:8px">' + (R.doc ? '<span class="badge b-green">✓ ' + esc(R.doc.name) + ' · ' + UI.fmtBytes(R.doc.size) + '</span>' : '') + '</div></div>';
    if (R.step === 3) body = '<div class="card"><h2>' + esc(t('reg_account')) + '</h2><label class="f">' + esc(t('reg_email')) + '<input type="email" id="rg_email" autocomplete="username" inputmode="email" value="' + esc(d.email || '') + '"></label><label class="f">' + esc(t('reg_password')) + '<input type="password" id="rg_password" autocomplete="new-password"></label><p class="hint">' + esc(t('reg_password_hint')) + '</p><label class="check"><input type="checkbox" id="rg_consent"' + (d.consent ? ' checked' : '') + '><span>' + esc(t('reg_consent')) + '</span></label></div>';
    UI.render(head + body + '<div class="row" style="margin-top:10px">' + (R.step > 0 ? '<button class="btn ghost" id="rgPrev">' + esc(t('back')) + '</button>' : '') + (R.step < 3 ? '<button class="btn primary" id="rgNext">' + esc(t('next')) + '</button>' : '<button class="btn primary" id="rgSend">' + esc(t('reg_submit')) + '</button>') + '<a class="btn ghost" href="#/pro/signin">' + esc(t('pro_signin')) + '</a></div><p class="err" id="rgErr"></p>', { back: true, title: t('reg_title') });
    const err = m => { $('#rgErr').textContent = m; };
    $$('[data-role]').forEach(b => b.onclick = () => { R.role = b.getAttribute('data-role'); $$('[data-role]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    const collect = () => {
      $$('input[id^="rg_"], select[id^="rg_"]').forEach(el => { const k = el.id.slice(3); if (el.type === 'checkbox') d[k] = el.checked; else if (el.type !== 'file' && el.type !== 'password') d[k] = el.value.trim(); });
      d.scope = $$('[data-scope]:checked').map(x => x.getAttribute('data-scope'));
      d.modes = $$('[data-mode]:checked').map(x => x.getAttribute('data-mode'));
      const langs = $$('[data-lang-cb]:checked').map(x => x.getAttribute('data-lang-cb')); if (langs.length) d.languages = langs;
    };
    if (R.step === 2) $('#rg_doc').onchange = e => UI.readFile(e.target.files[0], 2 * 1048576).then(r => { R.doc = r; $('#rgDocInfo').innerHTML = '<span class="badge b-green">✓ ' + esc(r.name) + ' · ' + UI.fmtBytes(r.size) + '</span>'; }).catch(er => err(er.message === 'size' ? t('too_large') : t('retry')));
    const prev = $('#rgPrev'); if (prev) prev.onclick = () => { if (R.step === 1) collect(); R.step--; view(); };
    const next = $('#rgNext'); if (next) next.onclick = () => {
      if (R.step === 0 && !R.role) return err(t('reg_role') + ': ' + t('required'));
      if (R.step === 1) { collect(); if (!d.name) return err(t('reg_fullname') + ': ' + t('required')); if (R.role !== 'wellbeing' && (!d.licenceNo || !d.issuer)) return err(t('reg_licence_no') + ': ' + t('required')); if (!d.phone) return err(t('phone') + ': ' + t('required')); if ((R.role === 'doctor' || R.role === 'nurse') && !d.scope.length) return err(t('scope') + ': ' + t('required')); if (R.role === 'wellbeing' && !d.service) return err(t('reg_service') + ': ' + t('required')); }
      R.step++; view();
    };
    const send = $('#rgSend'); if (send) send.onclick = async () => {
      const email = $('#rg_email').value.trim().toLowerCase(), pw = $('#rg_password').value; d.email = email; d.consent = $('#rg_consent').checked;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(t('reg_email') + ': ' + t('required'));
      if (pw.length < 8) return err(t('reg_password_hint'));
      if (!d.consent) return err(t('reg_consent').slice(0, 40) + '…: ' + t('required'));
      send.disabled = true; err('');
      try {
        const { col, role, record } = build();
        await DB.register({ col, role, record, name: record.name, email, password: pw, doc: R.doc });
        DB.audit('register', record.id, { result: role });
        R.step = 0; R.role = ''; R.d = {}; R.doc = null;
        UI.modal('<h2>' + esc(t('reg_done')) + '</h2><p>' + esc(t('reg_done_body')) + '</p><a class="btn primary block" href="#/pro" data-close>' + esc(t('pro_queue')) + '</a>');
      } catch (e) { send.disabled = false; err(/already|exists|registered/i.test(e.message) ? t('reg_exists') : e.message); }
    };
  }
  function build() {
    const d = R.d; const unit = d.adminUnit ? GEO.unit(d.adminUnit) : null; const lat = unit ? unit.lat : null, lng = unit ? unit.lng : null;
    const ver = { state: 'pending', verifiedAt: null, by: null, evidence: 'Self-registered on ' + DB.nowIso().slice(0, 10) + (R.doc ? ', licence document uploaded' : ', no document uploaded') };
    if (R.role === 'doctor' || R.role === 'nurse') {
      const prof = R.role === 'doctor' ? 'doctor' : (d.profession || 'nurse');
      return { col: 'practitioners', role: R.role, record: { id: DB.newId('PR'), name: d.name, profession: prof, specialty: d.specialty || (prof === 'doctor' ? 'General practitioner' : prof === 'midwife' ? 'Midwife' : 'Nurse'), scope: d.scope, gender: d.gender || 'f', languages: d.languages || [getLang()], licence: { no: d.licenceNo, issuer: d.issuer, status: 'pending', issued: '', expiry: d.expiry || '' }, facility: '', facilityName: d.facilityName || '', adminUnit: d.adminUnit || null, lat, lng, serviceArea: d.serviceArea || (unit ? unit.name : ''), modes: d.modes.length ? d.modes : ['by_appointment'], availability: 'by_appointment', verification: ver, bio: '', phone: d.phone, createdAt: DB.nowIso() } };
    }
    if (R.role === 'pharmacy') return { col: 'facilities', role: 'pharmacist', record: { id: DB.newId('PH'), name: d.name, type: 'pharmacy', adminUnit: d.adminUnit || null, lat, lng, coordsValidated: false, services: ['dispensing','otc'].concat(d.delivery ? ['delivery'] : []), emergencyCapable: false, hours: d.hours || '', phone: d.phone, registryId: '', responsiblePharmacist: d.responsiblePharmacist || '', licence: { no: d.licenceNo, issuer: d.issuer, status: 'pending', expiry: d.expiry || '' }, verification: ver, languages: d.languages || [getLang()], delivery: !!d.delivery, deliveryRadiusKm: d.delivery ? 5 : 0, serviceArea: d.serviceArea || '', createdAt: DB.nowIso() } };
    return { col: 'wellbeing', role: 'wellbeing', record: { id: DB.newId('WB'), name: d.name, service: d.service, gender: d.gender || 'f', languages: d.languages || [getLang()], adminUnit: d.adminUnit || null, lat, lng, serviceArea: d.serviceArea || (unit ? unit.name : ''), availability: 'by_appointment', price: d.price || '', safeguards: 'Identity checked at booking; platform check-in and check-out.', cancelTerms: '', licence: { no: d.licenceNo || '', issuer: '', status: d.licenceNo ? 'pending' : 'n/a', expiry: '' }, verification: ver, photo: '', phone: d.phone, createdAt: DB.nowIso() } };
  }
  return { view };
})();
