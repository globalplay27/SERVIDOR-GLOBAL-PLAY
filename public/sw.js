const CACHE="nexus-ai-v70";
const SHELL=[
  "/",
  "/portal.html?v=70",
  "/client.css?v=70",
  "/client.js?v=70",
  "/manifest.webmanifest?v=1",
  "/assets/nexus-ai-logo.png?v=3",
  "/assets/nexus-ai-mark.svg"
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==location.origin)return;
  if(url.pathname.startsWith("/api/"))return;

  // The client PWA must never control the Master surface. Keeping these
  // requests network-only prevents a stale portal fallback from replacing
  // /master with the client panel on the same workers.dev origin.
  const masterPath=url.pathname==="/master"
    || url.pathname.startsWith("/master/")
    || url.pathname==="/master-login"
    || url.pathname==="/index.html"
    || url.pathname==="/app.js"
    || url.pathname==="/styles.css";
  if(masterPath)return;

  if(request.mode==="navigate"){
    event.respondWith(fetch(request).catch(()=>caches.match("/portal.html?v=70")));
    return;
  }
  const liveAsset=["/client.js","/client.css","/portal.html"].includes(url.pathname);
  if(liveAsset){
    event.respondWith(fetch(request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      return response;
    }).catch(()=>caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
    return response;
  })));
});
