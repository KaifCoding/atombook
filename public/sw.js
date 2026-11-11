/* AtomBook service worker: makes the online version installable and usable offline.
 *
 * - Pages are fetched network-first (so a new deploy shows up on the next visit) and fall
 *   back to the last copy when offline.
 * - Hashed build files, fonts and icons are cache-first.
 * - Requests to other origins (Google sign-in, Google Drive) are never touched.
 * Bump VERSION to drop the old caches.
 */
const VERSION = 'v1';
const CACHE = `atombook-${VERSION}`;
const PAGES = ['/', '/documents/', '/documents/edit/', '/customers/', '/items/', '/reports/', '/design/', '/settings/'];
const FILES = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg', '/favicon-64.png', '/fonts/NotoSans-Regular.ttf', '/fonts/NotoSans-Bold.ttf', '/pdf.worker.min.mjs'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const assets = new Set(FILES);
      for (const page of PAGES) {
        try {
          const res = await fetch(page, { cache: 'reload' });
          if (!res.ok) continue;
          const html = await res.clone().text();
          await cache.put(page, res);
          // the JS/CSS files this page needs, so that it also opens offline when never visited
          for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) assets.add(m[0]);
        } catch (_) {
          /* offline during install: runtime caching fills the gaps */
        }
      }
      await Promise.all(
        [...assets].map(async (url) => {
          try {
            const res = await fetch(url);
            if (res.ok) await cache.put(url, res);
          } catch (_) {
            /* ignore */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('atombook-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

const isStatic = (url) => url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/fonts/') || /\.(?:png|svg|ico|webp|woff2?|ttf|mjs)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // pages and Next.js route data
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = (await caches.match(req)) || (await caches.match(url.pathname)) || (req.mode === 'navigate' ? await caches.match('/') : undefined);
        return hit || new Response('Offline', { status: 503, statusText: 'Offline' });
      }),
  );
});
