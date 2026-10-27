// PonyDrone è archiviata (codice in archive/ponydrone/ nel repository, non pubblicato).
// Questo service worker sostituisce quello vecchio sui dispositivi che avevano aperto /drone/:
// cancella le cache di PonyDrone, si disinstalla e rimanda le pagine aperte a PONY84.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ponydrone-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const open = await self.clients.matchAll({ type: 'window' });
    open.forEach((c) => c.navigate('/'));
  })());
});
