const CACHE_NAME = 'finanzas-gchu-v7';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=11',
  './app.js?v=11',
  './tickets.mjs?v=11',
  './productos.mjs?v=11',
  './compras.mjs?v=11',
  './listas-store.mjs?v=11',
  './listas.js?v=11',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

