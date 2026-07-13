/* ============================================================
   service-worker.js — offline caching
   ============================================================ */

const CACHE = "debt-tracker-v8";

// Relative paths so it works whether hosted at "/" or a subfolder.
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./db.js",
  "./auth.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

// Pre-cache the app shell on install.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Remove old caches on activate.
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for same-origin GETs: always serve the freshest file when
// online (so edits show on refresh), fall back to cache when offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (!req.url.startsWith(self.location.origin)) return; // let cross-origin pass through

  e.respondWith(
    fetch(req)
      .then((res) => {
        // Refresh the cache copy with the latest successful response.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        // Offline: serve from cache, falling back to the app shell.
        caches.match(req).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
