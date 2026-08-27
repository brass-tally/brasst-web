// Minimal app-shell service worker: makes Brasstally installable and
// serves a cached shell when offline. Network-first so fresh deploys win.
const CACHE = "brasstally-v3";
const SHELL = ["/app/", "/app/index.html", "/app/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // never intercept Supabase / API / cross-origin calls
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/app")) return;
  // A sign-in return carries its token in the URL; serving one from cache would
  // replay a spent token, so let those go straight to the network.
  if (url.search.includes("code=") || url.search.includes("token_hash=")) return;
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/app/index.html")))
  );
});
