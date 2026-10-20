# FUEL MCP Worker

This is the source for the existing Cloudflare Worker `fuel-chatgpt-api`. It keeps the current `/v1/meals` REST routes and adds OAuth-protected MCP at `/mcp`. It does not create or configure the separate `fuel-proxy` Worker.

## Authentication

- MCP clients authenticate through Cloudflare's `@cloudflare/workers-oauth-provider` library.
- Sign-in uses a GitHub OAuth App and is restricted to GitHub account ID `37054791`.
- MCP grants are `fuel:read`, `fuel:write`, and `offline_access`. Writing tools require both read and write grants.
- REST routes continue to require the existing `FUEL_API_TOKEN`.
- Supabase service role access remains server-side.

## One time setup

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Enter:
   - Application name: `FUEL ChatGPT`
   - Homepage URL: `https://fuel-chatgpt-api.joshh031.workers.dev`
   - Authorization callback URL: `https://fuel-chatgpt-api.joshh031.workers.dev/callback`
3. Save the app. Copy its **Client ID**. Click **Generate a new client secret** and keep that value private.
4. In Cloudflare, open **Workers & Pages → fuel-chatgpt-api → Settings → Variables and Secrets**. Add:
   - Variable `GITHUB_OAUTH_CLIENT_ID` = the GitHub app's Client ID.
   - Secret `GITHUB_OAUTH_CLIENT_SECRET` = the GitHub app's client secret.
5. Confirm the existing secrets `FUEL_API_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY`, the `SUPABASE_URL` variable, and the KV binding `OAUTH_KV` remain on this same Worker.

Do not paste any secret into GitHub, this README, or ChatGPT.

## Install and verify before deployment

From this directory:

```sh
npm install
npm run dry-run
```

The dry run compiles the Worker without publishing it. Then deploy this configuration to update the existing Worker:

```sh
npm run deploy
```

The Worker name in `wrangler.jsonc` is deliberately `fuel-chatgpt-api`; deploying it updates that Worker. Never change the name to `fuel-proxy`.

## Smoke checks after deployment

1. Open `https://fuel-chatgpt-api.joshh031.workers.dev/mcp`. An unauthenticated request should return HTTP 401 with OAuth resource metadata in the `WWW-Authenticate` header.
2. Check OAuth metadata at `https://fuel-chatgpt-api.joshh031.workers.dev/.well-known/oauth-authorization-server` and protected-resource metadata under `/.well-known/oauth-protected-resource`.
3. In ChatGPT, create a custom connector with URL `https://fuel-chatgpt-api.joshh031.workers.dev/mcp`. Choose OAuth when prompted. Sign in with the allowed GitHub account and approve the displayed FUEL scopes.
4. Use the connector to read one known date. Then log a small test meal only after reviewing and confirming the estimate. Verify the row in the FUEL app and delete the test row.

The OAuth consent screen is displayed for each authorization. ChatGPT must also be configured to ask before write actions if its connector permissions offer that setting.
