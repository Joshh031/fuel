const CACHE='fuel-v1';
const ASSETS=['./','./index.html','./manifest.json'];

self.addEventListener('install',e=>{
e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));
self.skipWaiting();
});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
const keys=await caches.keys();
await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
await clients.claim();
})()));

// Network-first for same-origin GETs so updates ship immediately,
// with cache fallback so the shell still opens offline.
self.addEventListener('fetch',e=>{
if(e.request.method!=='GET')return;
const url=new URL(e.request.url);
if(url.origin!==location.origin)return;
e.respondWith((async()=>{
try{
const res=await fetch(e.request);
if(res&&res.ok){const c=await caches.open(CACHE);c.put(e.request,res.clone());}
return res;
}catch(err){
const cached=await caches.match(e.request,{ignoreSearch:true});
if(cached)return cached;
if(e.request.mode==='navigate'){
const shell=await caches.match('./index.html')||await caches.match('./');
if(shell)return shell;
}
throw err;
}
})());
});

self.addEventListener('push',e=>{
let d={};
try{d=e.data.json();}catch(err){d={title:'FUEL',body:(e.data&&e.data.text())||''};}
e.waitUntil(self.registration.showNotification(d.title||'FUEL',{
body:d.body||'',
tag:d.tag||'fuel',
data:{url:d.url||'./'}
}));
});

self.addEventListener('notificationclick',e=>{
e.notification.close();
const url=(e.notification.data&&e.notification.data.url)||'./';
const action=new URL(url,self.location.href).searchParams.get('action');
e.waitUntil((async()=>{
const cs=await clients.matchAll({type:'window',includeUncontrolled:true});
for(const c of cs){
if('focus'in c){await c.focus();if(action)c.postMessage({action});return;}
}
await clients.openWindow(url);
})());
});
