// Root-scope worker for the marketing site. Its only jobs are to make the site
// installable from any page (Chrome wants a worker with a fetch handler) and to
// stay out of the way: /app/ has its own worker, and auth callbacks must never
// be served from a cache.
const CACHE = "brasstally-site-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The app registers its own worker at /app/sw.js — leave that scope alone.
  if (url.pathname.startsWith("/app")) return;
  // A sign-in return carries its token in the URL; never answer one from cache.
  if (url.search.includes("code=") || url.search.includes("token_hash=")) return;

  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request))
  );
});
