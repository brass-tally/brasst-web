// App-scope worker for /app.
//
// Deliberately network-first and aggressive about replacing itself. The
// previous generation of this worker cached an app shell that pointed at
// hashed bundles; once those hashes changed, a stale shell could load an
// asset set that no longer existed, or worse, run alongside the new one and
// mount a second React root into the same container. Two roots means two
// copies of the interface with separate state, which looks like sections
// stacking up and navigation half working.
//
// So: skipWaiting and claim immediately, delete every cache that is not this
// version, and never hand back a cached document when the network answers.
const CACHE = "brasstally-app-v4";
const SHELL = ["/app", "/app/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;        // never touch Supabase or Plaid
  if (!url.pathname.startsWith("/app")) return;           // the site has its own worker
  if (url.search.includes("code=") || url.search.includes("token_hash=")) return; // never cache a sign-in
  if (url.pathname.startsWith("/app/assets/")) return;    // hashed, immutable, let the CDN do it

  // Network first, always. The cache is a fallback for being offline, not a
  // source of truth, which is what stops a stale shell from resurfacing.
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || caches.match("/app")))
  );
});
