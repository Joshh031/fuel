import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,ownerAllowed,validateOperation} from '../supabase/functions/fuel-data/core.mjs';

const owner={sub:'DGmCAedCrNNBBURG55rFQOWKKba2',email:'joshh031@gmail.com',email_verified:true,
  firebase:{sign_in_provider:'google.com'},exp:Math.floor(Date.now()/1000)+3600};
const meal={id:1792800000000,date:'2026-10-24',meal_type:'lunch',description:'Test meal',notes:'',cal:400,prot:30,carb:40,fat:10,fiber:5,meal_time:'12:00 PM'};
const read={action:'get',table:'meals',filter:'date=eq.2026-10-24',order:'created_at.asc'};
function harness(claims=owner){
  const calls=[];
  const handler=createHandler({verifyToken:async token=>{if(token!=='verified-test-token')throw Error('Invalid signature');return claims;},database:async op=>{calls.push(op);return [{id:meal.id}];}});
  const send=(body=read,options={})=>handler(new Request('https://example.invalid/fuel-data',{
    method:options.method||'POST',headers:{'content-type':'application/json',authorization:'Bearer verified-test-token',origin:'https://joshh031.github.io',...options.headers},
    ...(options.method==='GET'||options.method==='OPTIONS'?{}:{body:options.raw??JSON.stringify(body)}),
  }));
  return {send,calls};
}
test('only the verified Google owner is authorized',()=>{
  assert.equal(ownerAllowed(owner),true);
  for(const change of [{sub:'other-user'},{email:'other@example.com'},{email_verified:false},{exp:1},{exp:undefined},{firebase:{sign_in_provider:'anonymous'}},{firebase:{sign_in_provider:'password'}}])
    assert.equal(ownerAllowed({...owner,...change}),false);
});
test('invalid and missing tokens never reach the database',async()=>{
  const h=harness();
  for(const authorization of ['', 'Bearer forged-token', 'Basic abc']) assert.equal((await h.send(read,{headers:{authorization}})).status,401);
  assert.equal(h.calls.length,0);
});
test('a valid token belonging to another account is denied',async()=>{
  const h=harness({...owner,sub:'other-user'});assert.equal((await h.send()).status,403);assert.equal(h.calls.length,0);
});
test('CORS only permits the actual FUEL origin',async()=>{
  const h=harness();
  const preflight=await h.send(null,{method:'OPTIONS'});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://joshh031.github.io');
  assert.equal((await h.send(read,{headers:{origin:'https://joshh031.github.io.attacker.invalid'}})).status,403);
  assert.equal(h.calls.length,0);
});
test('bounded reads and legitimate writes preserve FUEL functionality',async()=>{
  const h=harness();
  const operations=[read,{action:'get',table:'meals',filter:'date=gte.2026-09-24&date=lte.2026-10-24',order:'created_at.desc'},
    {action:'insert',table:'meals',data:meal},{action:'update',table:'meals',filter:'id=eq.1792800000000',data:{cal:500,description:'Updated'}},
    {action:'delete',table:'meals',filter:'id=eq.1792800000000'},
    {action:'upsert',table:'water_log',data:{date:'2026-10-24',cups:2}},
    {action:'upsert',table:'exercise_log',data:{date:'2026-10-24',exercise:'CHEST,RUN'}},
    {action:'upsert',table:'weight_log',data:{date:'2026-10-24',weight:172.4}},
    {action:'upsert',table:'push_subs',data:{endpoint:'https://push.example.invalid/abc',sub:{endpoint:'https://push.example.invalid/abc',keys:{auth:'abc',p256dh:'def'}}}}];
  for(const op of operations) assert.equal((await h.send(op)).status,200,JSON.stringify(op));
  assert.equal(h.calls.length,operations.length);
  assert.equal(h.calls[0].query.get('limit'),'1000');
  assert.equal(h.calls[5].prefer,'resolution=merge-duplicates,return=representation');
});
test('table escapes, unbounded deletes, injected filters and owner reassignment fail',async()=>{
  const h=harness();
  const attacks=[{...read,table:'planner_connections'},{...read,table:'../auth/users'},{...read,filter:'or=(date.eq.2026-10-24,true)'},
    {...read,filter:'date=eq.2026-10-24&select=*'},{...read,filter:''},{...read,filter:'date=eq.2026-02-30'},
    {...read,filter:'date=gte.2000-01-01&date=lte.2026-10-24'},
    {action:'delete',table:'meals',filter:''},{action:'delete',table:'meals',filter:'id=gte.1'},
    {action:'update',table:'meals',filter:'id=eq.1',data:{date:'2026-10-25'}},
    {action:'insert',table:'meals',data:{...meal,owner_id:'attacker'}},
    {action:'insert',table:'meals',data:{...meal,cal:'<img onerror=alert(1)>'}},
    {action:'get',table:'push_subs',filter:'date=eq.2026-10-24'},
    {action:'upsert',table:'push_subs',data:{endpoint:'http://localhost/internal',sub:{endpoint:'http://localhost/internal',keys:{auth:'a',p256dh:'b'}}}}];
  for(const op of attacks) assert.equal((await h.send(op)).status,400,JSON.stringify(op));
  assert.equal(h.calls.length,0);
});
test('body and method limits fail before database work',async()=>{
  const h=harness();
  assert.equal((await h.send(read,{method:'GET'})).status,405);
  assert.equal((await h.send(read,{raw:'not json'})).status,400);
  assert.equal((await h.send(read,{headers:{'content-type':'text/plain'}})).status,400);
  assert.equal((await h.send(read,{headers:{'content-length':'999999'}})).status,413);
  assert.equal((await h.send(read,{raw:JSON.stringify({padding:'a'.repeat(20000)})})).status,413);
  assert.equal(h.calls.length,0);
});
test('database errors are propagated without exposing server details',async()=>{
  const h=createHandler({verifyToken:async()=>owner,database:async()=>{throw Error('private configuration');}});
  const response=await h(new Request('https://example.invalid',{method:'POST',headers:{authorization:'Bearer ok','content-type':'application/json'},body:JSON.stringify(read)}));
  assert.equal(response.status,502);assert.ok(!(await response.text()).includes('private configuration'));
});
test('date filters cannot be duplicated to widen a mutation',()=>{
  assert.throws(()=>validateOperation({action:'delete',table:'water_log',filter:'date=eq.2026-10-24&date=eq.2026-10-25'}));
});
