import {
  AuthorizationError,
  OAuthProvider,
  authorizationErrorRedirect,
  insufficientScope,
} from "@cloudflare/workers-oauth-provider";

interface Env {
  OAUTH_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FUEL_API_TOKEN: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  FUEL_OWNER_GITHUB_ID: string;
}

interface AuthContext extends ExecutionContext {
  auth: { scope: string[]; userId: string; clientId: string };
  props: { userId: string };
}

const ORIGIN = "https://fuel-chatgpt-api.joshh031.workers.dev";
const RESOURCE = ORIGIN + "/mcp";
const OWNER_GITHUB_ID = "37054791";
const SCOPES = ["fuel:read", "fuel:write", "offline_access"];
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const ALLOWED = ["date", "meal_type", "description", "notes", "cal", "prot", "carb", "fat", "fiber"];
const TYPES = new Set(["breakfast", "lunch", "dinner", "snack", "drink"]);
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const err = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function validMeal(x: any, partial = false): boolean {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const keys = Object.keys(x);
  if (!keys.length || keys.some((k) => !ALLOWED.includes(k))) return false;
  if (!partial && ["date", "meal_type", "description", "cal", "prot", "carb", "fat", "fiber"].some((k) => !(k in x))) return false;
  if ("date" in x && !validDate(x.date)) return false;
  if ("meal_type" in x && !TYPES.has(x.meal_type)) return false;
  if ("description" in x && (typeof x.description !== "string" || !x.description.trim() || x.description.length > 500)) return false;
  if ("notes" in x && (typeof x.notes !== "string" || x.notes.length > 2000)) return false;
  for (const k of ["cal", "prot", "carb", "fat", "fiber"]) {
    if (k in x && (!Number.isFinite(x[k]) || x[k] < 0 || x[k] > 10000)) return false;
  }
  return true;
}
async function supabase(env: Env, path: string, method = "GET", body?: unknown): Promise<any> {
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let data: any;
  try { data = t ? JSON.parse(t) : null; } catch { data = null; }
  if (!r.ok) throw new Error("Database operation failed: " + r.status);
  return data;
}
async function stableId(key: string): Promise<number> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fuel-meal-v1:" + key));
  const v = new Uint8Array(b);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + v[i];
  return 100000000000000 + n;
}
async function getMeals(env: Env, date: string): Promise<any[]> {
  if (!validDate(date)) throw new Error("Valid date required");
  return await supabase(env, "meals?date=eq." + encodeURIComponent(date) + "&order=created_at.asc");
}
async function createMeal(env: Env, body: any, key: string): Promise<any> {
  if (typeof key !== "string" || key.length < 16 || key.length > 128) throw new Error("Idempotency key of 16–128 characters required");
  if (!validMeal(body)) throw new Error("Invalid meal");
  const id = await stableId(key);
  const existing = await supabase(env, "meals?id=eq." + id);
  if (existing.length) {
    const e = existing[0];
    if (ALLOWED.some((k) => k in body && e[k] !== body[k])) throw new Error("Idempotency key reused for different meal");
    return e;
  }
  const meal = {
    id,
    meal_time: new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }),
    ...body,
  };
  try {
    const result = await supabase(env, "meals", "POST", meal);
    return result[0];
  } catch (e) {
    const saved = await supabase(env, "meals?id=eq." + id);
    if (saved.length) return saved[0];
    throw e;
  }
}
async function modifyMeal(env: Env, id: number, data: any): Promise<any> {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid meal ID");
  if (!validMeal(data, true) || "date" in data) throw new Error("Invalid update");
  const updated = await supabase(env, "meals?id=eq." + id, "PATCH", data);
  if (!updated.length) throw new Error("Meal not found");
  return updated[0];
}
async function removeMeal(env: Env, id: number): Promise<any> {
  if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid meal ID");
  const existing = await supabase(env, "meals?id=eq." + id);
  if (!existing.length) throw new Error("Meal not found");
  await supabase(env, "meals?id=eq." + id, "DELETE");
  return { deleted: true, id };
}
const MEAL_PROPS = {
  date: { type: "string", description: "Meal date YYYY-MM-DD" },
  meal_type: { type: "string", enum: [...TYPES] },
  description: { type: "string" },
  notes: { type: "string" },
  cal: { type: "number", minimum: 0 },
  prot: { type: "number", minimum: 0 },
  carb: { type: "number", minimum: 0 },
  fat: { type: "number", minimum: 0 },
  fiber: { type: "number", minimum: 0 },
};
const TOOLS = [
  { name: "getMeals", description: "Read meals recorded in FUEL for one date.", inputSchema: { type: "object", properties: { date: MEAL_PROPS.date }, required: ["date"], additionalProperties: false } },
  { name: "createMeal", description: "Save a user-confirmed meal. Reuse idempotency_key when retrying the same meal.", inputSchema: { type: "object", properties: { ...MEAL_PROPS, idempotency_key: { type: "string", minLength: 16, maxLength: 128 } }, required: ["date", "meal_type", "description", "cal", "prot", "carb", "fat", "fiber", "idempotency_key"], additionalProperties: false } },
  { name: "modifyMeal", description: "Modify a user-confirmed existing meal by numeric ID; date cannot be changed.", inputSchema: { type: "object", properties: { id: { type: "integer" }, ...Object.fromEntries(Object.entries(MEAL_PROPS).filter(([k]) => k !== "date")) }, required: ["id"], additionalProperties: false } },
  { name: "removeMeal", description: "Permanently remove a user-confirmed meal by numeric ID.", inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } },
];
const rpc = (id: unknown, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { ...JSON_HEADERS, "access-control-expose-headers": "Mcp-Session-Id" } });
const rpcError = (id: unknown, code: number, message: string) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { headers: JSON_HEADERS });

async function mcp(req: Request, env: Env, ctx: AuthContext): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 16384) return err("Payload too large", 413);
  let msg: any;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "Parse error"); }
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || Array.isArray(msg)) return rpcError(msg?.id ?? null, -32600, "Invalid Request");
  if (msg.id === undefined) return new Response(null, { status: 202 });
  const name = msg.params?.name;
  const isWrite = msg.method === "tools/call" && ["createMeal", "modifyMeal", "removeMeal"].includes(name);
  const needed = isWrite ? ["fuel:read", "fuel:write"] : ["fuel:read"];
  if (!needed.every((scope) => ctx.auth.scope.includes(scope))) return insufficientScope(ctx.auth, needed);

  if (msg.method === "initialize") return rpc(msg.id, { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "fuel-meals", version: "1.0.0" } });
  if (msg.method === "ping") return rpc(msg.id, {});
  if (msg.method === "tools/list") return rpc(msg.id, { tools: TOOLS });
  if (msg.method !== "tools/call") return rpcError(msg.id, -32601, "Method not found");
  const args = msg.params?.arguments || {};
  if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, "Unknown tool");
  try {
    let result: any;
    if (name === "getMeals") result = await getMeals(env, args.date);
    else if (name === "createMeal") {
      const { idempotency_key, ...body } = args;
      result = await createMeal(env, body, idempotency_key);
    } else if (name === "modifyMeal") {
      const { id, ...body } = args;
      result = await modifyMeal(env, id, body);
    } else result = await removeMeal(env, args.id);
    return rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: { result } });
  } catch (e: any) {
    return rpc(msg.id, { content: [{ type: "text", text: e.message.startsWith("Database") ? "Database operation failed" : e.message }], isError: true });
  }
}

function consentPage(details: any, handle: string): string {
  const name = escapeHtml(details.clientName);
  const domain = details.clientDomain
    ? "Published by <strong>" + escapeHtml(details.clientDomain) + "</strong>."
    : "This app registered itself; its name is not verified.";
  const scopes = details.scope.map((scope: string) =>
    '<label><input type="checkbox" name="scope" value="' + escapeHtml(scope) + '" checked> ' + escapeHtml(scope) + "</label>"
  ).join("<br>");
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + "<title>Authorize " + name + "</title><h1>Allow " + name + " to access FUEL?</h1>"
    + "<p>" + domain + " Access will be sent to <strong>" + escapeHtml(details.redirectHost) + "</strong>.</p>"
    + (details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>" : "")
    + '<p>FUEL read access lets ChatGPT view saved meals. FUEL write access lets it add, edit, or delete meals after your confirmation.</p>'
    + '<form method="post"><input type="hidden" name="handle" value="' + escapeHtml(handle) + '">'
    + scopes + '<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p></form>';
}
function errorPage(message: string, status = 400): Response {
  return new Response("<!doctype html><meta charset=utf-8><title>FUEL sign-in error</title><p>" + escapeHtml(message) + "</p>", {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
async function s256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function requireOAuthConfig(env: Env) {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) throw new Error("GitHub OAuth app credentials are not configured.");
}
const oauth = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: { fetch: (request, env, ctx) => mcp(request, env, ctx as AuthContext) },
  defaultHandler: {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === "/authorize") return authorize(request, env);
      if (url.pathname === "/callback") return callback(request, env);
      return rest(request, env);
    },
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  scopesSupported: SCOPES,
  requiredScopes: ["fuel:read"],
  resourceMetadata: {
    resource: RESOURCE,
    authorization_servers: [ORIGIN],
    resource_name: "FUEL meals",
  },
  clientIdMetadataDocumentEnabled: true,
  refreshTokenTTL: 2592000,
});

async function authorize(request: Request, env: Env): Promise<Response> {
  const api = (env as any).OAUTH_PROVIDER;
  if (request.method === "GET") {
    let authRequest: any;
    try {
      authRequest = await api.parseAuthRequest(request);
      const details = await api.describeConsent(authRequest);
      const consent = await api.beginConsent(authRequest);
      consent.headers.set("content-type", "text/html; charset=utf-8");
      consent.headers.set("cache-control", "no-store");
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    } catch (e: any) {
      if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
      if (e instanceof AuthorizationError) return errorPage(e.description);
      return errorPage("Could not start FUEL authorization.", 500);
    }
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
  try {
    requireOAuthConfig(env);
    const form = await request.formData();
    const handle = String(form.get("handle") || "");
    if (form.get("decision") !== "approve") {
      const denied = await api.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await api.approveConsent(request, handle, {
      scope: form.getAll("scope").map(String),
    });
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const { state, headers } = await api.beginUpstream(approved.request, {
      data: { verifier },
      headers: approved.headers,
    });
    const callbackUrl = ORIGIN + "/callback";
    const params = new URLSearchParams({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      redirect_uri: callbackUrl,
      scope: "read:user",
      state,
      code_challenge: await s256(verifier),
      code_challenge_method: "S256",
    });
    headers.set("Location", "https://github.com/login/oauth/authorize?" + params.toString());
    return new Response(null, { status: 302, headers });
  } catch (e: any) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return errorPage(e.description);
    return errorPage("Could not continue FUEL authorization.", 500);
  }
}
async function callback(request: Request, env: Env): Promise<Response> {
  requireOAuthConfig(env);
  const api = (env as any).OAUTH_PROVIDER;
  let resumed: any;
  try {
    resumed = await api.finishUpstream(request);
  } catch (e: any) {
    if (e instanceof AuthorizationError) return errorPage(e.description);
    throw e;
  }
  const { request: authRequest, data, headers } = resumed;
  const url = new URL(request.url);
  if (url.searchParams.has("error")) {
    headers.set("Location", authorizationErrorRedirect(authRequest, "access_denied"));
    return new Response(null, { status: 302, headers });
  }
  const code = url.searchParams.get("code");
  if (!code || !data?.verifier) return errorPage("GitHub did not return a sign-in code.");
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: ORIGIN + "/callback",
      code_verifier: data.verifier,
    }),
  });
  const token = await tokenResponse.json<any>();
  if (!tokenResponse.ok || !token.access_token) return errorPage("GitHub sign-in failed.");
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: "Bearer " + token.access_token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "FUEL-MCP" },
  });
  const githubUser = await userResponse.json<any>();
  if (!userResponse.ok || String(githubUser.id) !== (env.FUEL_OWNER_GITHUB_ID || OWNER_GITHUB_ID)) {
    return errorPage("This GitHub account is not allowed to connect to FUEL.", 403);
  }
  const { redirectTo } = await api.completeAuthorization({
    request: authRequest,
    userId: String(githubUser.id),
    metadata: { githubLogin: githubUser.login },
    scope: authRequest.scope.filter((scope: string) => SCOPES.includes(scope)),
    props: { userId: String(githubUser.id) },
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

async function rest(request: Request, env: Env): Promise<Response> {
  if (!env.FUEL_API_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) return err("Service not configured", 503);
  if (request.headers.get("Authorization") !== "Bearer " + env.FUEL_API_TOKEN) return err("Unauthorized", 401);
  const url = new URL(request.url);
  if (!/^\/v1\/meals(?:\/\d+)?$/.test(url.pathname)) return err("Not found", 404);
  try {
    if (request.method === "GET" && url.pathname === "/v1/meals") {
      const date = url.searchParams.get("date");
      if (!date || !validDate(date)) return err("Valid date required");
      return json(await getMeals(env, date));
    }
    if (request.method === "POST" && url.pathname === "/v1/meals") {
      const key = request.headers.get("Idempotency-Key");
      if (!key || key.length < 16 || key.length > 128) return err("Idempotency-Key of 16–128 characters required");
      if (Number(request.headers.get("content-length") || 0) > 8192) return err("Payload too large", 413);
      const body = await request.json();
      if (!validMeal(body)) return err("Invalid meal");
      const result = await createMeal(env, body, key);
      return json(result, 201);
    }
    const match = url.pathname.match(/^\/v1\/meals\/(\d+)$/);
    if (match && ["PATCH", "DELETE"].includes(request.method)) {
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id)) return err("Invalid meal ID");
      if (request.method === "DELETE") {
        await removeMeal(env, id);
        return new Response(null, { status: 204 });
      }
      if (Number(request.headers.get("content-length") || 0) > 8192) return err("Payload too large", 413);
      const data = await request.json();
      if (!validMeal(data, true) || "date" in data) return err("Invalid update");
      return json(await modifyMeal(env, id, data));
    }
    return err("Method not allowed", 405);
  } catch (e: any) {
    if (e.message === "Meal not found") return err(e.message, 404);
    if (e.message.startsWith("Database")) return err("Database operation failed", 502);
    return err("Request failed", 500);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/mcp" && !env.SUPABASE_SERVICE_ROLE_KEY) return err("Service not configured", 503);
    return oauth.fetch(request, env, ctx);
  },
};
