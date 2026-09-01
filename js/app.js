/* App shell: router, language, network state, install prompt, channel detection, service worker */
const APP = (() => {
  const { $, $$, esc } = UI;
  let deferredInstall = null;

  const ROUTES = [
    [/^\/?$/, () => getLang() ? PATIENT.home() : PATIENT.langChooser()],
    [/^\/lang$/, () => PATIENT.langChooser()],
    [/^\/emergency$/, () => PATIENT.emergency()],
    [/^\/find$/, () => PATIENT.find()],
    [/^\/p\/(practitioner|pharmacy|facility|wellbeing)\/([\w-]+)$/, m => PATIENT.profile(m[1], m[2])],
    [/^\/request$/, () => PATIENT.request()],
    [/^\/voice$/, () => PATIENT.voice()],
    [/^\/rx$/, () => PATIENT.rx()],
    [/^\/products$/, () => PATIENT.products()],
    [/^\/cart$/, () => PATIENT.cartView()],
    [/^\/book\/([\w-]+)$/, m => PATIENT.book(m[1])],
    [/^\/cases$/, () => PATIENT.cases()],
    [/^\/case\/([\w-]+)$/, m => PATIENT.caseView(m[1])],
    [/^\/order\/([\w-]+)$/, m => PATIENT.orderView(m[1])],
    [/^\/guide$/, () => PATIENT.guide()],
    [/^\/menu$/, () => PATIENT.menu()],
    [/^\/packs$/, () => PATIENT.packs()],
    [/^\/about$/, () => PATIENT.page('about_body', 'menu_about')],
    [/^\/privacy$/, () => PATIENT.page('privacy_body', 'menu_privacy')],
    [/^\/rights$/, () => PATIENT.rights()],
    [/^\/complaint$/, () => PATIENT.complaint()],
    [/^\/pro\/signin$/, () => PRO.signin()],
    [/^\/pro$/, () => PRO.dashboard()],
    [/^\/pro\/case\/([\w-]+)$/, m => PRO.proCase(m[1])],
    [/^\/pro\/order\/([\w-]+)$/, m => PRO.proOrder(m[1])],
    [/^\/admin$/, () => ADMIN.view()]
  ];
  function route() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const path = hash.split('?')[0];
    if (!getLang() && path !== '/lang') { PATIENT.langChooser(); return; }
    for (const r of ROUTES) { const m = path.match(r[0]); if (m) { try { r[1](m); } catch (e) { console.error(e); UI.render('<div class="alert red">Error: ' + esc(e.message) + '</div><a class="btn" href="#/">' + esc(t('nav_home')) + '</a>'); } nav(path); return; } }
    UI.go('#/');
  }
  function nav(path) {
    const key = path === '/' ? 'home' : path.startsWith('/find') || path.startsWith('/p/') ? 'find' : path.startsWith('/case') || path.startsWith('/order') ? 'cases' : path === '/guide' ? 'guide' : 'menu';
    $$('#bottomnav a').forEach(a => a.classList.toggle('active', a.getAttribute('data-nav') === key));
    const isPro = path.startsWith('/pro') || path.startsWith('/admin');
    document.getElementById('bottomnav').hidden = isPro && !!DB.session();
    document.getElementById('btnSOS').hidden = (isPro && !!DB.session()) || path === '/emergency';
    document.getElementById('topbar').classList.toggle('pro', isPro);
  }
  function channel() { if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) return 'telegram'; const ua = navigator.userAgent || ''; if (/WhatsApp/i.test(ua)) return 'whatsapp'; if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'pwa'; return 'web'; }
  function netState() { const d = document.getElementById('netdot'); const on = navigator.onLine; d.classList.toggle('off', !on); d.title = on ? t('online') : t('offline'); d.setAttribute('aria-label', on ? t('online') : t('offline')); }
  function installPrompt(boxId) {
    const box = document.getElementById(boxId); if (!box) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    if (deferredInstall || ios) { box.innerHTML = '<div class="card"><div class="row between"><div><b>' + esc(t('install_app')) + '</b><div class="small muted">' + esc(t('install_hint')) + (ios ? ' · Safari: Share → Add to Home Screen' : '') + '</div></div>' + (deferredInstall ? '<button class="btn small" id="doInstall">⬇</button>' : '') + '</div></div>'; const b = $('#doInstall'); if (b) b.onclick = () => { deferredInstall.prompt(); deferredInstall = null; box.innerHTML = ''; }; }
  }
  function langSheet() {
    UI.modal('<h2>' + esc(t('choose_lang')) + '</h2><div class="lang-grid">' + LANGS.map(l => '<button data-lang="' + l.code + '" aria-pressed="' + (getLang() === l.code) + '" lang="' + l.code + '">' + esc(l.native) + '<br><small class="muted">' + esc(l.name) + '</small></button>').join('') + '</div><p class="hint">' + esc(t('lang_persist')) + '</p>', (el, close) => { $$('[data-lang]', el).forEach(b => b.onclick = () => { setLang(b.getAttribute('data-lang')); close(); route(); }); });
  }
  function init() {
    DB.init(); initLang();
    if (window.Telegram && window.Telegram.WebApp) { try { window.Telegram.WebApp.ready(); window.Telegram.WebApp.expand(); } catch (e) {} }
    document.getElementById('btnLang').onclick = langSheet;
    document.getElementById('btnBack').onclick = () => history.length > 1 ? history.back() : UI.go('#/');
    document.getElementById('btnSOS').onclick = () => UI.go('#/emergency');
    window.addEventListener('hashchange', route);
    window.addEventListener('online', netState); window.addEventListener('offline', netState); netState();
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const b = document.getElementById('installBox'); if (b) installPrompt('installBox'); });
    // Cloud sync: pull on start, on reconnect, on focus and on an interval; re-render live views when rows changed
    DB.on(kind => { if (kind !== 'sync') return; const path = location.hash.replace(/^#/, '').split('?')[0]; const wizard = /^\/(request|rx|cart|book|guide|lang|complaint|rights)/.test(path); if (!wizard && document.getElementById('modal').hidden) route(); });
    if (DB.remote && DB.remote.enabled) { DB.sync(); window.addEventListener('online', () => DB.sync()); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') DB.sync(); }); setInterval(() => { if (document.visibilityState === 'visible') DB.sync(); }, ((window.DEHNA_CONFIG || {}).syncIntervalSec || 20) * 1000); }
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith('hwc.') && e.key !== 'hwc.lang') { DB.init(); route(); } });
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) { navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e)); }
    CASES.syncQueued();
    route();
  }
  document.addEventListener('DOMContentLoaded', init);
  return { route, channel, installPrompt };
})();
