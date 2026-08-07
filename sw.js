const CACHE_NAME = 'costa-v4';

const PRECACHE = [
  '/plataforma-costa/',
  '/plataforma-costa/index.html',
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE).catch(function(err) {
        console.warn('[SW] Falha ao pre-cachear:', err);
      });
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Nunca intercepta APIs externas
  if (url.includes('firebaseio.com') || url.includes('firebase.googleapis.com') ||
      url.includes('mercadolibre.com') || url.includes('workers.dev') ||
      url.includes('labelary.com') || url.includes('googleapis.com') ||
      url.includes('shopee')) return;

  if (event.request.method !== 'GET') return;

  // Arquivos JS e paginas always-fresh — nunca serve do cache
  if (url.includes('.js') || url.endsWith('/') || url.includes('.html')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Outros recursos (CSS, imagens) usa cache
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200 && response.type !== 'opaque') {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});
