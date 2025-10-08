const CACHE = "avignon-cache-v1";
const OFFLINE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/ag-grid-community.min.js",
  "/ag-grid.css",
  "/lib/idb.mjs",
  "/lib/xlsx.full.min.js",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon-180.png",
  "/favicon.ico",
  "/manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Network-first, fallback cache (bon compromis dev)
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});