const OWNER_UID = 'DGmCAedCrNNBBURG55rFQOWKKba2';
const OWNER_EMAIL = 'joshh031@gmail.com';
const ORIGIN = 'https://joshh031.github.io';
const TABLES = new Set(['meals', 'exercise_log', 'water_log', 'weight_log', 'push_subs']);
const ACTIONS = new Set(['get', 'insert', 'update', 'delete', 'upsert']);
const MAX_BYTES = 16384;
const MACROS = ['cal', 'prot', 'carb', 'fat', 'fiber'];
const MEAL_FIELDS = ['id', 'date', 'meal_type', 'description', 'notes', ...MACROS, 'meal_time'];
const EXERCISES = new Set(['REST', 'RUN', 'LEGS', 'BACK', 'CHEST', 'SHOULDERS']);

export function ownerAllowed(p) {
  return p?.sub === OWNER_UID && p.email_verified === true &&
    p.email?.toLowerCase() === OWNER_EMAIL && p.firebase?.sign_in_provider === 'google.com' &&
    Number.isFinite(p.exp) && p.exp > Date.now() / 1000;
}
function validDate(s) {
  if (typeof s !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s;
}
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const number = (n, max, integer = true) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max && (!integer || Number.isInteger(n));
const text = (s, max) => typeof s === 'string' && s.length <= max;
function assert(ok, message = 'Invalid request') { if (!ok) throw new Error(message); }

function validateRecord(table, data, partial) {
  assert(plain(data) && Object.keys(data).length > 0);
  const fields = table === 'meals' ? MEAL_FIELDS : table === 'exercise_log' ? ['date', 'exercise'] : table === 'water_log' ? ['date', 'cups'] : table === 'weight_log' ? ['date', 'weight'] : ['endpoint', 'sub'];
  assert(Object.keys(data).every(k => fields.includes(k)));
  if (!partial) {
    const required = table === 'meals' ? ['id', 'date', 'meal_type', 'description', ...MACROS] : fields;
    assert(required.every(k => k in data));
  }
  if ('date' in data) assert(validDate(data.date));
  if ('id' in data) assert(Number.isSafeInteger(data.id) && data.id > 0);
  if ('meal_type' in data) assert(['breakfast','lunch','dinner','snack','drink'].includes(data.meal_type));
  if ('description' in data) assert(text(data.description, 1000) && data.description.trim().length > 0);
  if ('notes' in data) assert(text(data.notes, 4000));
  if ('meal_time' in data) assert(text(data.meal_time, 30));
  for (const key of MACROS) if (key in data) assert(number(data[key], 20000));
  if ('cups' in data) assert(number(data.cups, 100));
  if ('weight' in data) assert(number(data.weight, 1500, false) && data.weight > 0);
  if ('exercise' in data) assert(text(data.exercise, 100) && data.exercise.split(',').every(x => EXERCISES.has(x.trim())));
  if (table === 'push_subs') {
    assert(text(data.endpoint, 3000) && plain(data.sub));
    const u = new URL(data.endpoint);
    assert(u.protocol === 'https:' && !u.username && !u.password && data.sub.endpoint === data.endpoint);
    assert(plain(data.sub.keys) && text(data.sub.keys.auth, 256) && text(data.sub.keys.p256dh, 256));
  }
  return data;
}

export function validateOperation(body) {
  assert(plain(body) && Object.keys(body).every(k => ['action','table','filter','order','data'].includes(k)));
  const { action, table } = body;
  assert(ACTIONS.has(action) && TABLES.has(table));
  assert(typeof (body.filter ?? '') === 'string' && (body.filter ?? '').length <= 200);
  const query = new URLSearchParams();
  const filters = [...new URLSearchParams(body.filter || '').entries()];
  const dates = [];
  let idCount = 0;
  for (const [key, value] of filters) {
    if (key === 'id' && table === 'meals') {
      assert(/^eq\.[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value.slice(3))));
      idCount++;
    } else {
      assert(key === 'date' && /^(eq|gte|lte)\.20\d{2}-\d{2}-\d{2}$/.test(value) && validDate(value.slice(value.indexOf('.') + 1)));
      dates.push(value);
    }
    query.append(key, value);
  }
  assert(idCount <= 1 && !(idCount && dates.length));
  if (action === 'get') {
    assert(table !== 'push_subs' && !('data' in body));
    assert((idCount === 1 && dates.length === 0) || (dates.length === 1 && dates[0].startsWith('eq.')) ||
      (dates.length === 2 && dates.some(x => x.startsWith('gte.')) && dates.some(x => x.startsWith('lte.'))));
    if (dates.length === 2) {
      const start = dates.find(x => x.startsWith('gte.')).slice(4), end = dates.find(x => x.startsWith('lte.')).slice(4);
      assert(start <= end && (+new Date(end) - +new Date(start)) / 86400000 <= 366);
    }
    if (body.order) { assert(['date.asc','date.desc','created_at.asc','created_at.desc'].includes(body.order)); query.set('order', body.order); }
    query.set('limit', '1000');
  } else {
    assert(!body.order);
    if (action === 'delete' || action === 'update') {
      assert(table !== 'push_subs' && filters.length === 1 && (table === 'meals' ? idCount === 1 : dates.length === 1 && dates[0].startsWith('eq.')));
    } else assert(filters.length === 0);
    if (action !== 'delete') {
      validateRecord(table, body.data, action === 'update');
      if (action === 'update') assert(!('id' in body.data) && !('date' in body.data));
      if (action === 'upsert') assert(table !== 'meals');
      if (table === 'push_subs') assert(action === 'upsert');
    } else assert(!('data' in body));
  }
  return { table, query, method: ({get:'GET',insert:'POST',update:'PATCH',delete:'DELETE',upsert:'POST'})[action], data: body.data,
    prefer: action === 'upsert' ? 'resolution=merge-duplicates,return=representation' : 'return=representation' };
}

async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_BYTES) throw new RangeError('Request too large');
  assert((req.headers.get('content-type') || '').split(';')[0].trim() === 'application/json', 'JSON required');
  const reader = req.body?.getReader();
  assert(reader);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError('Request too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { data.set(chunk, at); at += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(data));
}

export function createHandler({verifyToken, database}) {
  return async req => {
    const origin = req.headers.get('origin');
    const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'Origin','x-content-type-options':'nosniff'};
    if (origin === ORIGIN) Object.assign(headers, {'access-control-allow-origin':ORIGIN,'access-control-allow-headers':'authorization, content-type, apikey','access-control-allow-methods':'POST, OPTIONS','access-control-max-age':'600'});
    const respond = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), {status, headers});
    if (origin && origin !== ORIGIN) return respond({error:'Origin not allowed'},403);
    if (req.method === 'OPTIONS') return respond(null,204);
    if (req.method !== 'POST') return respond({error:'Method not allowed'},405);
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.get('authorization') || '');
    if (!match) return respond({error:'Sign in required'},401);
    let claims;
    try { claims = await verifyToken(match[1]); } catch { return respond({error:'Session expired or invalid'},401); }
    if (!ownerAllowed(claims)) return respond({error:'This account cannot access FUEL'},403);
    let operation;
    try { operation = validateOperation(await readBody(req)); }
    catch (e) { return respond({error:e instanceof RangeError ? 'Request too large' : 'Invalid request'}, e instanceof RangeError ? 413 : 400); }
    try {
      const result = await database(operation);
      if (['PATCH','DELETE'].includes(operation.method) && Array.isArray(result) && result.length === 0)
        return respond({error:'That record no longer exists. Refresh FUEL and retry.'},404);
      return respond(result);
    }
    catch { return respond({error:'Unable to save or load data. Please retry.'},502); }
  };
}
