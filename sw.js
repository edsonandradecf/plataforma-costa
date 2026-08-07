// Service Worker - Plataforma Costa
const CACHE_NAME = 'costa-v3';
const CACHE_URLS = [
  '/plataforma-costa/',
  '/plataforma-costa/index.html',
];

// Instala e ativa imediatamente
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  // Limpa caches antigos
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Sempre busca da rede para arquivos .js — nunca serve do cache
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // Arquivos JS e paginas sempre da rede
  if (url.includes('.js') || url.includes('.html')) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Resto usa cache
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request);
    })
  );
});
