/* Dehna (Han's With Care) service worker
   Strategy (ToR §11 offline architecture):
   - Precache only the lightweight application shell (< 500 KB).
   - Region packs (data/packs/*.json) are cached on explicit user request.
   - Never cache clinical content, prescriptions or case data (those live in the
     encrypted queue inside the app, not in the HTTP cache).
   - Navigation falls back to the cached shell when offline. */
const VERSION = 'dehna-v1.1.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './config.js', './css/app.css',
  './js/i18n.js', './js/seed.js', './js/store.js', './js/geo.js', './js/ui.js',
  './js/guide.js', './js/patient.js', './js/pro.js', './js/admin.js', './js/app.js',
  './assets/logo.png', './assets/icon-192.png', './assets/icon-512.png'
];
const PACKS = VERSION + '-packs';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== VERSION && k !== PACKS).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'CACHE_PACK' && m.url) {
    e.waitUntil(caches.open(PACKS).then(c => c.add(m.url)).then(() => notify({ type: 'PACK_CACHED', url: m.url })).catch(() => notify({ type: 'PACK_FAILED', url: m.url })));
  }
  if (m.type === 'DROP_PACK' && m.url) {
    e.waitUntil(caches.open(PACKS).then(c => c.delete(m.url)));
  }
  if (m.type === 'SKIP_WAITING') self.skipWaiting();
});

function notify(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then(cs => cs.forEach(c => c.postMessage(msg)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // map tiles / CDN: network only, never cached by us

  // Region packs: cache-first from the packs cache
  if (url.pathname.includes('/data/packs/')) {
    e.respondWith(caches.open(PACKS).then(c => c.match(req).then(r => r || fetch(req))));
    return;
  }
  // Navigation: network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  // Shell assets: stale-while-revalidate
  e.respondWith(caches.open(VERSION).then(c => c.match(req).then(cached => {
    const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  })));
});
