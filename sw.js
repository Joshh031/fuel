self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));

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
