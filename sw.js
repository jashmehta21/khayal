/* Khayal service worker — makes the app work fully offline. */
const VERSION = "khayal-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./manifest.webmanifest",
  "./fonts/outfit.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Stale-while-revalidate: instant load from cache, silently fetch updates
   in the background so the next launch runs the newest version. */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((resp) => {
          if (resp && resp.ok) cache.put(e.request, resp.clone());
          return resp;
        })
        .catch(() => undefined);
      if (cached) { e.waitUntil(network); return cached; }
      const resp = await network;
      if (resp) return resp;
      if (e.request.mode === "navigate") return cache.match("./index.html");
      return Response.error();
    })
  );
});
