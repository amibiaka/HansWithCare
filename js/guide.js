/* Guide (ToR §10): deterministic, rules-based assistant.
   Order of evaluation for every message: (1) clinician-approved red-flag layer, (2) intent routing to verified
   services, (3) retrieval from the curated, versioned knowledge base, (4) fallback with human handoff.
   No generative model is called in the demonstration build. GUIDE.gateway is the single hook where an approved,
   Ethiopia-hosted model gateway can be attached later; it must keep steps (1) and (4) and log model/version. */
const GUIDE = (() => {
  const VERSION = 'guide-rules-0.1.0';
  function norm(s) { return String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim(); }

  function redFlag(text) {
    const n = norm(text); if (!n) return null;
    for (const r of DB.all('redFlags')) { for (const lang of Object.keys(r.kw)) { if (r.kw[lang].some(k => n.includes(norm(k)))) return r; } }
    return null;
  }
  const INTENTS = [
    { id: 'emergency', kw: ['emergency','urgent','ambulance','police','fire','911','907','939','አደጋ','ህጹጽ','hatattama','degdeg','urgence'], to: '#/emergency' },
    { id: 'practitioner', kw: ['doctor','nurse','midwife','health worker','clinic','consult','appointment','specialist','ዶክተር','ሐኪም','ነርስ','ሓኪም','doktora','narsii','dhakhtar','kalkaaliye','médecin','infirmier','soignant'], to: '#/find?type=practitioner' },
    { id: 'pharmacy', kw: ['pharmacy','medicine','drug','tablet','prescription','available','stock','ፋርማሲ','መድሃኒት','ማዘዣ','faarmaasii','qoricha','farmashiye','dawo','pharmacie','médicament','ordonnance'], to: '#/find?type=pharmacy' },
    { id: 'products', kw: ["han's",'hans','pad','pads','period underwear','diaper','incontinence','buy','order','ፓድ','ምርት','paadii','oomisha','xijaab','alaab','serviette','couche','produit'], to: '#/products' },
    { id: 'wellbeing', kw: ['massage','fitness','trainer','yoga','coach','sport','ማሳጅ','maasaajii','duugis','jimicsi','bien-être'], to: '#/find?type=wellbeing' },
    { id: 'voice', kw: ['voice','record','speak','audio','ድምጽ','sagalee','cod','vocal'], to: '#/voice' },
    { id: 'requests', kw: ['my request','status','tracking','reference','ጥያቄዬ','codsigayga','ma demande','suivi'], to: '#/cases' },
    { id: 'privacy', kw: ['privacy','delete my','my data','consent','ግላዊነት','dhuunfaa','sir','confidentialité','données'], to: '#/privacy' }
  ];
  function intent(text) { const n = norm(text); return INTENTS.find(i => i.kw.some(k => n.includes(norm(k)))) || null; }
  function retrieve(text) {
    const n = norm(text); const words = n.split(/[^a-zሀ-፿؀-ۿ']+/).filter(w => w.length > 2);
    let best = null, bs = 0;
    DB.all('kb').forEach(k => { let s = 0; k.tags.forEach(tg => { if (n.includes(norm(tg))) s += 3; }); words.forEach(w => { if (norm(k.title.en).includes(w) || norm(k.body.en).includes(w) || (k.body.fr && norm(k.body.fr).includes(w))) s += 1; }); if (s > bs) { bs = s; best = k; } });
    return bs >= 2 ? best : null;
  }
  function kbText(k, lang) { const b = k.body[lang] || k.body.en; const title = k.title[lang] || k.title.en; return { title, body: b, translated: !!k.body[lang] }; }

  // Structured intake summary in the user's own words (ToR §10 permitted uses)
  function summarize(turns) { return turns.filter(x => x.who === 'me').map(x => x.text).join(' · ').slice(0, 600); }

  function log(input, kind, ref) { const arr = DB.all('guideLog'); arr.push({ id: DB.newId('GL'), at: DB.nowIso(), lang: getLang(), version: VERSION, kind, ref: ref || '', len: (input || '').length, redFlag: kind === 'redflag' }); if (arr.length > 500) arr.splice(0, arr.length - 500); DB.setObj('guideLog', arr); }

  // Reply builder. Returns {text, actions:[{label, to}], kb, redFlag}
  function reply(text) {
    const lang = getLang();
    if (!DB.flag('guide')) return { text: t('guide_off'), actions: [] };
    const rf = redFlag(text);
    if (rf) { log(text, 'redflag', rf.id); return { redFlag: rf, text: t('guide_redflag'), actions: [{ label: t('t_emergency'), to: '#/emergency', cls: 'danger' }] }; }
    const kb = retrieve(text);
    const it = intent(text);
    if (kb) { log(text, 'kb', kb.id); const k = kbText(kb, lang); return { kb, text: k.body, title: k.title, source: kb.source + ' · v' + kb.version + ' · ' + kb.approvedAt, translated: k.translated, actions: it ? [{ label: t('t_' + (it.id === 'products' ? 'products' : it.id === 'pharmacy' ? 'pharmacy' : it.id === 'emergency' ? 'emergency' : 'practitioner')), to: it.to }] : [{ label: t('t_practitioner'), to: '#/find?type=practitioner' }] }; }
    if (it) { log(text, 'intent', it.id); const map = { emergency: 't_emergency', practitioner: 't_practitioner', pharmacy: 't_pharmacy', products: 't_products', wellbeing: 't_wellbeing', voice: 't_voice', requests: 'nav_cases', privacy: 'menu_privacy' }; return { text: t('guide_intro'), actions: [{ label: t(map[it.id]), to: it.to }] }; }
    log(text, 'fallback');
    return { text: t('guide_unknown'), actions: [{ label: t('t_practitioner'), to: '#/find?type=practitioner' }, { label: t('t_pharmacy'), to: '#/find?type=pharmacy' }, { label: t('t_emergency'), to: '#/emergency', cls: 'danger' }] };
  }
  // Practitioner draft helper: non-binding summary the professional must review (ToR §10)
  function draftForPractitioner(c) {
    const lines = [];
    lines.push('Summary of request ' + c.id + ' (' + c.lang + '):');
    if (c.need) lines.push('Need: ' + c.need + (c.urgency ? ', urgency ' + c.urgency : ''));
    if (c.text) lines.push('In the patient\'s words: "' + c.text.slice(0, 300) + '"');
    if (c.attachments && c.attachments.length) lines.push('Attachments: ' + c.attachments.map(a => a.kind).join(', '));
    lines.push('Suggested reply (edit before sending): Thank you for your request. I have read it. ' + (c.urgency === 'urgent' ? 'Please call me on the number in your case so we can speak today.' : 'I will respond with next steps; if symptoms worsen, call emergency services.'));
    return lines.join('\n');
  }
  return { VERSION, redFlag, intent, retrieve, kbText, summarize, reply, draftForPractitioner, gateway: null };
})();
