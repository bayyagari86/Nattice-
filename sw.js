// Service Worker for Trump Call PWA
const CACHE_NAME = 'trump-call-v29';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './crypto.js',
  './engine.js',
  './network.js',
  './game.js',
  './ui.js',
  './badges.js',
  './fx.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
];

// Install — cache core assets (individual fetches so one miss doesn't abort install)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first for API/CDN, cache-first for app shell
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Network-first for external resources (PeerJS, fonts, etc.)
  if (url.origin !== location.origin) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for the app shell: in a multiplayer game every player
  // must run the same protocol version, so fresh code wins whenever the
  // network is up. The cache is the offline fallback.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.ok && event.request.method === 'GET') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
