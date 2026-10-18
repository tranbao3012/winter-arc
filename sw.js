// sw.js
// Service Worker cho Winter Arc PWA
// - Network-first cho HTML
// - Cache-first cho asset tĩnh
// - Hỗ trợ notification click, periodic sync, push
// - Chia sẻ state nhắc nhở qua Cache API (key /__reminder-state)

const CACHE_NAME = 'winter-arc-v2';
const META_CACHE = 'winter-arc-meta';
const REMINDER_STATE_PATH = '/__reminder-state';
const PERIODIC_TAG = 'winter-arc-daily-check';
const APP_SHELL = [
  './winter-arc.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ===== LIFECYCLE =====
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('SW install cache failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== META_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === REMINDER_STATE_PATH) return;

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

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => new Response('Offline', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      }));
    })
  );
});

// ===== REMINDER HELPERS =====
async function readReminderState() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match(REMINDER_STATE_PATH);
    if (!res) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function writeReminderState(state) {
  try {
    const cache = await caches.open(META_CACHE);
    await cache.put(REMINDER_STATE_PATH, new Response(JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch (e) {}
}

function formatLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function showArcNotification(count) {
  await self.registration.showNotification('WINTER ARC', {
    body: `${count} nhiệm vụ chưa hoàn thành`,
    tag: 'winter-arc-daily',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: './winter-arc.html' }
  });
}

async function runReminderCheck(force) {
  const state = await readReminderState();
  if (!state) return;
  if (!state.enabled) return;
  if (!state.time || !/^\d{2}:\d{2}$/.test(state.time)) return;

  const now = new Date();
  const today = formatLocalDate(now);
  if (state.lastNotifiedDate === today) return;

  const [hh, mm] = state.time.split(':').map(Number);
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (!force && now < target) return;
  if (!force && state.incompleteCount <= 0) return;

  await showArcNotification(state.incompleteCount || 0);
  state.lastNotifiedDate = today;
  await writeReminderState(state);
}

// ===== BACKGROUND EVENTS =====
self.addEventListener('periodicsync', (event) => {
  if (event.tag !== PERIODIC_TAG) return;
  event.waitUntil(runReminderCheck(false));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'winter-arc-reminder') {
    event.waitUntil(runReminderCheck(false));
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'WINTER ARC', body: 'Kiểm tra nhiệm vụ' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = Object.assign(payload, parsed);
    }
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: 'winter-arc-push',
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: { url: payload.url || './winter-arc.html' }
    })
  );
});

// ===== NOTIFICATION INTERACTION =====
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './winter-arc.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  // Hook cho analytics nếu cần. Hiện tại no-op.
});

// ===== MESSAGE HANDLING =====
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'UPDATE_REMINDER_STATE' && data.state) {
    event.waitUntil(writeReminderState(data.state));
    return;
  }

  if (data.type === 'SHOW_REMINDER' && typeof data.count === 'number') {
    event.waitUntil(showArcNotification(data.count));
    return;
  }

  if (data.type === 'CHECK_REMINDER_NOW') {
    event.waitUntil(runReminderCheck(true));
    return;
  }
});
