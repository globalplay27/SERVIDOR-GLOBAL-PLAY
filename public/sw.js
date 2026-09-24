const CACHE="nexus-ai-v67";
const SHELL=[
  "/portal.html?v=67",
  "/client.css?v=67",
  "/client.js?v=67",
  "/manifest.webmanifest?v=1",
  "/assets/nexus-ai-logo.png?v=3",
  "/assets/nexus-ai-mark.svg"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;

  const url=new URL(request.url);
  if(url.origin!==location.origin)return;
  if(url.pathname.startsWith("/api/"))return;

  const authOrMaster=
    url.pathname==="/" ||
    url.pathname==="/login" ||
    url.pathname==="/portal-login" ||
    url.pathname==="/master" ||
    url.pathname==="/master/" ||
    url.pathname==="/master-login" ||
    url.pathname==="/master-logout";

  // Authentication and MASTER routes must never be replaced by the cached
  // client portal. Always let the server decide the response and cookies.
  if(authOrMaster){
    event.respondWith(fetch(request,{cache:"no-store"}));
    return;
  }

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request,{cache:"no-store"})
        .catch(()=>caches.match("/portal.html?v=67"))
    );
    return;
  }

  const liveAsset=["/client.js","/client.css","/portal.html"].includes(url.pathname);
  if(liveAsset){
    event.respondWith(
      fetch(request,{cache:"no-store"}).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
        return response;
      }).catch(()=>caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      return response;
    }))
  );
});
