// Caches every file the game needs so it runs with no signal.
//
// Files are only ever cached here, at install time, all together. Nothing
// fetched later can overwrite them, so a Wi-Fi login page (common on planes
// and in airports) can't replace the game.
//
// To ship an update, change VERSION. Phones fetch this file when they open the
// game online, see it changed, and download the new set in the background.
const VERSION = 'v18';
const CACHE = 'livewire-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('livewire-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    try {
      return await fetch(req);
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});
