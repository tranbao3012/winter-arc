// sw.js
// Service Worker cho Winter Arc PWA
// Chiến lược: network-first cho HTML, cache-first cho asset tĩnh

const CACHE_NAME = 'winter-arc-v1';
const APP_SHELL = [
  './winter-arc.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Cài đặt: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('SW install cache failed:', err))
  );
});

// Kích hoạt: dọn cache cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: phân loại request
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Chỉ xử lý GET
  if (req.method !== 'GET') return;

  // Bỏ qua request không phải http/https (extension, chrome-extension, ...)
  if (!req.url.startsWith('http')) return;

  const url = new URL(req.url);

  // Chỉ xử lý cùng origin
  if (url.origin !== self.location.origin) {
    return;
  }

  // HTML: network-first, fallback cache
  const isHtml = req.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');

  if (isHtml) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => {
          return cached || caches.match('./winter-arc.html');
        }))
    );
    return;
  }

  // Asset tĩnh: cache-first, fallback network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => {
        // Không có cache, không có mạng
        return new Response('Offline', {
          status: 503,
          statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});

// Cho phép trang chủ động kích hoạt SW mới
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});