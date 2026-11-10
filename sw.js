// App-shell service worker. All paths are relative to this file's own
// location so the cache works whether the app is served at the domain root
// or under a GitHub Pages subpath like /<repo-name>/.

const CACHE_NAME = 'wardrobe-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/style.css',
  './src/app.js',
  './src/db.js',
  './src/engine.js',
  './src/weather.js',
  './src/seed.js',
  './src/ui/today.js',
  './src/ui/wardrobe.js',
  './src/ui/settings.js',
  './src/ui/history.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept cross-origin requests (e.g. Open-Meteo) — weather.js
  // already fails gracefully offline; the service worker shouldn't mask that.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});
