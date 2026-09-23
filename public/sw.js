const CACHE="nexus-ai-v38";
const SHELL=[
  "/",
  "/portal.html?v=38",
  "/client.css?v=38",
  "/client.js?v=38",
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
  if(request.mode==="navigate"){
    event.respondWith(fetch(request).catch(()=>caches.match("/portal.html?v=38")));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
    return response;
  })));
});
