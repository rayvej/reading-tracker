const CACHE_NAME = 'reading-tracker-v100';
const BASE = self.location.pathname.replace('/sw.js', '/');
const STATIC_ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'style.css?v=100',
  BASE + 'app.js?v=100',
  BASE + 'js/install-prompt.js',
  BASE + 'js/offline-db.js',
  BASE + 'js/seed10YearData.js',
  BASE + 'js/modules/ui.js',
  BASE + 'js/modules/stats.js',
  BASE + 'js/modules/export.js',
  BASE + 'js/modules/image.js',
  BASE + 'js/modules/offline.js',
  BASE + 'firebase-config.js',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'seed-data.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/daisyui@4.4.19/dist/full.css',
  'https://cdn.tailwindcss.com'
];

// ── Install: cache static assets gracefully ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => {
          return fetch(url, { cache: 'reload' }).then(response => {
            if (!response.ok) {
              console.warn(`[SW] Precache skipped for ${url}: status ${response.status}`);
              return;
            }
            return cache.put(url, response);
          }).catch(err => {
            console.warn(`[SW] Precache fetch error for ${url}:`, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for HTML & Firebase, cache-first for assets ──────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip Chrome extension requests and non-GET
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // HTML navigation & root document — Network First, falling back to cache
  if (event.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname === BASE) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Google Fonts — cache first (versioned/immutable)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Firebase (Firestore / Auth) — network first, fallback nothing
  if (url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('gstatic') ||
      url.hostname.includes('google.com')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response.ok) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
          cache.keys().then(keys => {
            if (keys.length > 100) {
              cache.delete(keys[0]);
            }
          });
        });
        return response;
      });
    })
  );
});

// ── Background Sync: auto-flush pending reading logs when online ──────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-reading-logs') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        if (clients.length > 0) {
          clients.forEach(client => {
            client.postMessage({ type: 'SYNC_OFFLINE_LOGS' });
          });
        } else {
          return Promise.reject(new Error('No active clients to sync'));
        }
      })
    );
  }
});

// ── Web Push Notifications: Display payload when app is open or closed ────────
self.addEventListener('push', event => {
  let payload = { title: 'Reading Tracker', body: 'Daily reading reminder.' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload.body = event.data.text();
    }
  }
  const options = {
    body: payload.body,
    icon: payload.icon || BASE + 'icon-192.png',
    badge: payload.badge || BASE + 'icon-192.png',
    tag: payload.tag || 'daily-reading-reminder',
    data: payload.data || {}
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ── Notification Click: Focus existing app window or open PWA ─────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : BASE;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
