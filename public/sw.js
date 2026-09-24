// NEXUS migration cleanup worker.
// During the Cloudflare cutover we intentionally remove the old PWA worker
// because it could intercept /master and serve the client portal.
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
    await self.registration.unregister().catch(() => false);
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true }).catch(() => []);
    for (const client of clients) {
      try { client.navigate(client.url); } catch {}
    }
  })());
});

// No fetch handler on purpose: requests must go directly to Cloudflare.
