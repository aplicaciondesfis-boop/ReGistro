const CACHE_NAME = 'finanzas-gchu-v15';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=19',
  './app.js?v=19',
  './tickets.mjs?v=12',
  './productos.mjs?v=12',
  './compras.mjs?v=19',
  './listas-store.mjs?v=19',
  './listas.js?v=19',
  './listas-entrada.mjs?v=19',
  './identidad-productos.mjs?v=18',
  './preferencias.mjs?v=16',
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

