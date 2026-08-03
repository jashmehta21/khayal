/* Khayal service worker — offline shell + to-do notifications. */
/* Bump VERSION and the ?v= tags in index.html together when shipping changes. */
const VERSION = "khayal-v25";
const ASSETS = [
  "./",
  "./index.html",
  "./app.css?v=24",
  "./mind.js?v=7",
  "./app.js?v=20",
  "./manifest.webmanifest",
  "./fonts/jakarta.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Navigations are network-first so a new version shows up immediately (falling
   back to cache when offline). Other assets are stale-while-revalidate. */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copy = resp.clone();
          e.waitUntil(caches.open(VERSION).then((c) => c.put("./index.html", copy)));
          return resp;
        })
        .catch(async () => {
          const cache = await caches.open(VERSION);
          return (await cache.match("./index.html")) || Response.error();
        })
    );
    return;
  }

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      // match on the full URL — the ?v= tag is what makes a new build a new file
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((resp) => {
          if (resp && resp.ok) cache.put(e.request, resp.clone());
          return resp;
        })
        .catch(() => undefined);
      if (cached) { e.waitUntil(network); return cached; }
      const resp = await network;
      return resp || Response.error();
    })
  );
});

/* tapping a to-do reminder opens Khayal on the to-dos screen */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow("./") : undefined;
    })
  );
});
