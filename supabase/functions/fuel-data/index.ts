import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.0.0';
import { createHandler } from './core.mjs';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const verifyToken = async (token: string) => (await jwtVerify(token, keys, {
  issuer: 'https://securetoken.google.com/familyhub-d72f8',
  audience: 'familyhub-d72f8', algorithms: ['RS256'], requiredClaims: ['sub','exp','iat'],
})).payload;

async function database(op: {table:string;query:URLSearchParams;method:string;data?:unknown;prefer:string}) {
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('Database configuration missing');
  const headers: Record<string,string> = {apikey:key,'content-type':'application/json',Prefer:op.prefer};
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const url = new URL(`/rest/v1/${op.table}`, base);
  url.search = op.query.toString();
  const response = await fetch(url, {method:op.method,headers,body:op.data === undefined ? undefined : JSON.stringify(op.data),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('Database request failed');
  const content = await response.text();
  return content ? JSON.parse(content) : [];
}
Deno.serve(createHandler({verifyToken,database}));
