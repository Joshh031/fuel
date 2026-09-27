// FUEL reminder worker — runs on a Cloudflare cron trigger, checks Supabase
// for whether anything was logged today (America/New_York), and sends a Web
// Push nudge to every subscription in push_subs if not.
//
// Required settings (Worker → Settings → Variables and Secrets):
//   SB_URL             https://<project>.supabase.co
//   SB_KEY             Supabase anon key (same one the app uses)
//   VAPID_PUBLIC_KEY   the exact VAPID_PUB string from index.html
//   VAPID_PRIVATE_KEY  (secret) the private key from the same generated pair
//   VAPID_SUBJECT      mailto:<your email> — contact address push services require
//   TEST_KEY           (secret) any random string; enables manual test via
//                      GET https://<worker-url>/?key=<TEST_KEY>&force=1
// Cron trigger (Worker → Settings → Triggers): 0 * * * *  (hourly; the code
// gates on local time, so DST is handled automatically)

const TZ = 'America/New_York';
// Local hours at which to check and nag if nothing is logged yet today
const REMIND_HOURS = [12, 20];
// Stop nagging if there's been no logging at all for this many days
const ACTIVE_WINDOW_DAYS = 14;

// ── small helpers ────────────────────────────────────────────────
const utf8 = (s) => new TextEncoder().encode(s);
const cat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
const b64u = {
  dec(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const b = atob(s);
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  },
  enc(u) {
    let s = '';
    for (const b of new Uint8Array(u)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
};

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// ── RFC 8291 payload encryption (aes128gcm, single record) ───────
export async function encryptPayload(plaintext, p256dhB64, authB64, testVec) {
  const uaPub = b64u.dec(p256dhB64);      // subscriber public key, 65-byte uncompressed point
  const authSecret = b64u.dec(authB64);   // subscriber auth secret, 16 bytes
  const asKeys = testVec?.asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, cat(utf8('WebPush: info\0'), uaPub, asPub), 32);
  const salt = testVec?.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = cat(utf8(plaintext), new Uint8Array([2])); // 0x02 delimiter = last record
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, padded));
  const header = cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub); // rs=4096
  return cat(header, ct);
}

// ── VAPID (RFC 8292) Authorization header ────────────────────────
export async function vapidAuthHeader(endpoint, env, nowSec) {
  const pub = b64u.dec(env.VAPID_PUBLIC_KEY); // 0x04 || x(32) || y(32)
  const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u.enc(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u.enc(utf8(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: (nowSec || Math.floor(Date.now() / 1000)) + 12 * 3600,
    sub: env.VAPID_SUBJECT,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(h + '.' + p)));
  return `vapid t=${h}.${p}.${b64u.enc(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function sendPush(sub, payload, env) {
  const body = await encryptPayload(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': await vapidAuthHeader(sub.endpoint, env),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '3600',
      'Urgency': 'normal',
    },
    body,
  });
  return res.status;
}

// ── Supabase ─────────────────────────────────────────────────────
async function sbGet(env, table, query) {
  const r = await fetch(`${env.SB_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: env.SB_KEY, Authorization: 'Bearer ' + env.SB_KEY },
  });
  if (!r.ok) throw new Error('supabase ' + r.status);
  return r.json();
}
async function sbDel(env, table, query) {
  await fetch(`${env.SB_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: { apikey: env.SB_KEY, Authorization: 'Bearer ' + env.SB_KEY },
  });
}

// ── scheduling ───────────────────────────────────────────────────
function localParts(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10) % 24 };
}
function dateMinus(dstr, n) {
  const [y, m, d] = dstr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

async function runCheck(env, force) {
  const { date, hour } = localParts(env.TZ || TZ);
  if (!force && !REMIND_HOURS.includes(hour)) return `off-hour (${hour}:00 ${env.TZ || TZ})`;
  const loggedToday = await sbGet(env, 'meals', `date=eq.${date}&select=id&limit=1`);
  if (loggedToday.length) return 'already logged today';
  const recent = await sbGet(env, 'meals', `date=gte.${dateMinus(date, ACTIVE_WINDOW_DAYS)}&select=id&limit=1`);
  if (!recent.length) return 'no activity in ' + ACTIVE_WINDOW_DAYS + ' days, staying quiet';
  const subs = await sbGet(env, 'push_subs', 'select=endpoint,sub');
  if (!subs.length) return 'no push subscriptions';
  const msg = hour < 15
    ? { title: 'FUEL', body: 'Nothing logged yet today. What did you have for breakfast?', tag: 'fuel-reminder', url: './?action=log' }
    : { title: 'FUEL', body: 'No meals logged today. Log your day before it slips — takes 30 seconds.', tag: 'fuel-reminder', url: './?action=log' };
  let sent = 0, dropped = 0;
  for (const row of subs) {
    try {
      const s = typeof row.sub === 'string' ? JSON.parse(row.sub) : row.sub;
      const status = await sendPush(s, msg, env);
      if (status === 404 || status === 410) { // subscription expired — prune it
        await sbDel(env, 'push_subs', `endpoint=eq.${encodeURIComponent(row.endpoint)}`);
        dropped++;
      } else if (status >= 200 && status < 300) sent++;
    } catch (e) { /* one bad sub shouldn't stop the rest */ }
  }
  return `sent ${sent}/${subs.length}${dropped ? `, pruned ${dropped} dead` : ''}`;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheck(env, false));
  },
  // manual trigger for testing: GET https://<worker>/?key=<TEST_KEY>&force=1
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!env.TEST_KEY || u.searchParams.get('key') !== env.TEST_KEY) return new Response('forbidden', { status: 403 });
    try {
      return new Response(await runCheck(env, u.searchParams.get('force') === '1'));
    } catch (e) {
      return new Response('error: ' + e.message, { status: 500 });
    }
  },
};
