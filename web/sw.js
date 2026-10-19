// PONY84 service worker: l'app funziona anche senza rete.
// Pagine: prima la rete (così gli aggiornamenti arrivano subito), poi la copia salvata.
// Altri file: la copia salvata subito, aggiornata in sottofondo. Il nome della cache segue la versione.
const VERSION = '0.8.0';
const CACHE = 'pony84-' + VERSION, FONTS = 'pony84-fonts';
const SHELL = [
  '/', '/guide/', '/novita/', '/crediti/', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
  '/vendor/movewire/index.js', '/vendor/movewire/device.js', '/vendor/movewire/protocol.js', '/vendor/movewire/web-midi.js'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function fresh(req, cacheName) {   // copia salvata subito, aggiornata in sottofondo
  return caches.open(cacheName).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(fresh(req, FONTS)); return; }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('/'))));
    return;
  }
  e.respondWith(fresh(req, CACHE));
});
