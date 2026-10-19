// FUEL personal API — separate Cloudflare Worker, not the existing AI proxy.
// Environment secrets: FUEL_API_TOKEN, SUPABASE_SERVICE_ROLE_KEY. Var: SUPABASE_URL.
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const ALLOWED = ['date','meal_type','description','notes','cal','prot','carb','fat','fiber'];
const TYPES = new Set(['breakfast','lunch','dinner','snack','drink']);
const err = (message, status=400) => new Response(JSON.stringify({error:message}),{status,headers:JSON_HEADERS});
const json = (value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
function validMeal(x,partial=false){
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const keys=Object.keys(x);
  if(!keys.length||keys.some(k=>!ALLOWED.includes(k)))return false;
  if(!partial&&['date','meal_type','description','cal','prot','carb','fat','fiber'].some(k=>!(k in x)))return false;
  if('date' in x&&(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||Number.isNaN(Date.parse(x.date+'T12:00:00Z'))))return false;
  if('meal_type' in x&&!TYPES.has(x.meal_type))return false;
  if('description' in x&&(typeof x.description!=='string'||!x.description.trim()||x.description.length>500))return false;
  if('notes' in x&&(typeof x.notes!=='string'||x.notes.length>2000))return false;
  for(const k of ['cal','prot','carb','fat','fiber']) if(k in x&&(!Number.isFinite(x[k])||x[k]<0||x[k]>10000))return false;
  return true;
}
async function supabase(env,path,method='GET',body){
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{
    method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,
      'content-type':'application/json','Prefer':'return=representation'},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  const t=await r.text();let data;try{data=t?JSON.parse(t):null;}catch{data=null;}
  if(!r.ok)throw new Error('Database operation failed: '+r.status);
  return data;
}
async function stableId(key){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('fuel-meal-v1:'+key));
  const v=new Uint8Array(b);let n=0;for(let i=0;i<6;i++)n=n*256+v[i];
  // Keep below JS safe integer and distinguish from original millisecond timestamp IDs.
  return 100000000000000+n;
}
export default {
  async fetch(req,env){
    try{
      if(!env.FUEL_API_TOKEN||!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_URL)return err('Service not configured',503);
      const token=req.headers.get('Authorization');
      if(!token||token!=='Bearer '+env.FUEL_API_TOKEN)return err('Unauthorized',401);
      const url=new URL(req.url);
      if(!/^\/v1\/meals(?:\/\d+)?$/.test(url.pathname))return err('Not found',404);
      if(req.method==='GET'&&url.pathname==='/v1/meals'){
        const date=url.searchParams.get('date');
        if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return err('Valid date required');
        return json(await supabase(env,'meals?date=eq.'+encodeURIComponent(date)+'&order=created_at.asc'));
      }
      if(req.method==='POST'&&url.pathname==='/v1/meals'){
        const key=req.headers.get('Idempotency-Key');
        if(!key||key.length<16||key.length>128)return err('Idempotency-Key of 16–128 characters required');
        if(Number(req.headers.get('content-length')||0)>8192)return err('Payload too large',413);
        const body=await req.json();
        if(!validMeal(body))return err('Invalid meal');
        const id=await stableId(key);
        const existing=await supabase(env,'meals?id=eq.'+id);
        if(existing.length){
          const e=existing[0];
          if(ALLOWED.some(k=>k in body&&e[k]!==body[k]))return err('Idempotency key reused for different meal',409);
          return json(e);
        }
        const meal={id,meal_time:new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit'}),...body};
        try{const result=await supabase(env,'meals','POST',meal);return json(result[0],201);}
        catch(e){
          const saved=await supabase(env,'meals?id=eq.'+id);
          if(saved.length)return json(saved[0]);
          throw e;
        }
      }
      const match=url.pathname.match(/^\/v1\/meals\/(\d+)$/);
      if(match&&['PATCH','DELETE'].includes(req.method)){
        const id=Number(match[1]);
        if(!Number.isSafeInteger(id))return err('Invalid meal ID');
        if(req.method==='DELETE'){
          await supabase(env,'meals?id=eq.'+id,'DELETE');return new Response(null,{status:204});
        }
        if(Number(req.headers.get('content-length')||0)>8192)return err('Payload too large',413);
        const data=await req.json();if(!validMeal(data,true)||('date' in data))return err('Invalid update');
        const updated=await supabase(env,'meals?id=eq.'+id,'PATCH',data);
        return updated.length?json(updated[0]):err('Meal not found',404);
      }
      return err('Method not allowed',405);
    }catch(e){return err('Request failed',500);}
  }
};
