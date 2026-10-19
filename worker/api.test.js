import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';

const env = {
  FUEL_API_TOKEN: 'test-secret-not-for-production',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key'
};

function call(path, opts={}) {
  return worker.fetch(new Request('https://fuel.example'+path,opts), env);
}

test('rejects unauthenticated requests without accessing database', async () => {
  const response = await call('/v1/meals?date=2026-10-19');
  assert.equal(response.status,401);
});

test('rejects wrong token', async () => {
  const response = await call('/v1/meals?date=2026-10-19',{headers:{Authorization:'Bearer wrong'}});
  assert.equal(response.status,401);
});

test('requires valid date for listing', async () => {
  const response = await call('/v1/meals?date=bad',{headers:{Authorization:'Bearer '+env.FUEL_API_TOKEN}});
  assert.equal(response.status,400);
});

test('rejects invalid create operation before calling database', async () => {
  const response = await call('/v1/meals',{
    method:'POST',
    headers:{Authorization:'Bearer '+env.FUEL_API_TOKEN,'Idempotency-Key':'1234567890123456','Content-Type':'application/json'},
    body:JSON.stringify({date:'2026-10-19',meal_type:'lunch',description:'Turkey sandwich',cal:-1,prot:30,carb:30,fat:10,fiber:2})
  });
  assert.equal(response.status,400);
});

test('rejects unsupported operations and endpoints', async () => {
  const headers={Authorization:'Bearer '+env.FUEL_API_TOKEN};
  assert.equal((await call('/v1/other',{headers})).status,404);
  assert.equal((await call('/v1/meals',{method:'PUT',headers})).status,405);
});

test('GET returns mapped response from Supabase', async () => {
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(JSON.stringify([{id:123,description:'Breakfast'}]),{status:200,headers:{'Content-Type':'application/json'}});
    const response=await call('/v1/meals?date=2026-10-19',{headers:{Authorization:'Bearer '+env.FUEL_API_TOKEN}});
    assert.equal(response.status,200);
    assert.equal((await response.json())[0].description,'Breakfast');
  }finally{globalThis.fetch=originalFetch;}
});

test('POST uses same idempotency key for retries', async () => {
  const originalFetch=globalThis.fetch;
  const rows=new Map();
  try{
    globalThis.fetch=async (url,options)=>{
      const p=new URL(url);
      const id=Number(p.searchParams.get('id')?.replace('eq.',''));
      if(options.method==='GET')return new Response(JSON.stringify(rows.has(id)?[rows.get(id)]:[]),{status:200});
      if(options.method==='POST'){
        const m=JSON.parse(options.body);
        rows.set(m.id,m);
        return new Response(JSON.stringify([m]),{status:201});
      }
      throw new Error('unexpected request');
    };
    const body=JSON.stringify({date:'2026-10-19',meal_type:'lunch',description:'Turkey sandwich',cal:400,prot:30,carb:35,fat:15,fiber:3});
    const opts={method:'POST',headers:{Authorization:'Bearer '+env.FUEL_API_TOKEN,'Idempotency-Key':'meal-test-unique-2026-10-19','Content-Type':'application/json'},body};
    const first=await call('/v1/meals',opts);
    assert.equal(first.status,201);
    const firstMeal=await first.json();
    const second=await call('/v1/meals',opts);
    assert.equal(second.status,200);
    assert.equal((await second.json()).id,firstMeal.id);
    assert.equal(rows.size,1);
  }finally{globalThis.fetch=originalFetch;}
});
