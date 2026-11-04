/* Cache only the signal-only TradeDesk and its essential assets. */
const CACHE='mrg-tradedesk-signals-v4';
const ASSETS=['./','./index.html','./futures-lab.js?v=2','./tradedesk-valr-client.js?v=3','./manifest.webmanifest','./icon-192.svg'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith('mrg-tradedesk-')&&key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(async()=>await caches.match(event.request)||(
    event.request.mode==='navigate'?await caches.match('./index.html'):Response.error()
  )));
});
