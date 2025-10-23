const CACHE = "avignon-cache-v2";
const OFFLINE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./AppContext.js",
  "./ActiviteRenderer.js",
  "./LieuRenderer.js",
  "./TelRenderer.js",
  "./WebRenderer.js",
  "./ui_state.mjs",
  "./activites.js",
  "./carnet.js",
  "./utils-date.js",
  "./utils.js",
  "./ag-grid-community.min.js",
  "./ag-grid.css",
  "./lib/idb.mjs",
  "./lib/xlsx.full.min.js",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon-180.png",
  "./favicon.ico",
  "./manifest.webmanifest"
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

  // Navigation request ? (clic lien / barre d'adresse)
  const isNavigation = req.mode === 'navigate' ||
                       (req.destination === '' && req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));

  if (isNavigation) {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        // met en cache au passage
        const copy = net.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return net;
      } catch {
        // fallback SPA
        const cachedIndex = await caches.match('/index.html') || await caches.match('./index.html');
        return cachedIndex || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' }});
      }
    })());
    return;
  }

  // Stratégie network-first pour le reste
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});