/* Blisscco service worker (Phase 10).
   - Offline: page navigations go to the network; if that fails, the saved app shell (index.html, no user data in it)
     is served so the app still opens and can show the customer's data saved on the device; if there is no shell yet,
     /offline.html is shown.
   - Cache: the offline page, icons, the app shell and hashed build files (/assets/*, immutable). NEVER /api/*, Supabase,
     or any signed-in data, so nothing private is stored by this worker (the app keeps its own per-user copy, removed on log out).
   - Push: shows a notification and opens the right page when it is tapped. */
const VERSION = 'v3';
const SHELL_KEY = '/index.html';   // every app route returns this same page (SPA)
const SHELL_CACHE = 'blisscco-shell-' + VERSION;
const ASSET_CACHE = 'blisscco-assets-' + VERSION;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-96.png', '/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase, Cashfree, fonts: browser handles them
  if (url.pathname.startsWith('/api/')) return;             // never cache API calls

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const type = res.headers.get('content-type') || '';
        if (res.ok && res.status === 200 && type.includes('text/html') && !res.redirected) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(SHELL_KEY, copy)).catch(() => {});
        }
        return res;
      }).catch(() =>
        caches.match(SHELL_KEY).then((shell) => shell || caches.match('/offline.html')).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {                // hashed files never change, so cache-first is safe
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })),
      ),
    );
    return;
  }

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

// ---------------- Push ----------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Blisscco', body: event.data ? event.data.text() : '' }; }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Blisscco';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target = '/';
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
    if (u.origin === self.location.origin) target = u.pathname + u.search + u.hash;   // same-site links only
  } catch (e) { /* keep '/' */ }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
