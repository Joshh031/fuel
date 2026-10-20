# FUEL MCP Worker

This is the source for the existing Cloudflare Worker `fuel-chatgpt-api`. It keeps the current `/v1/meals` REST routes and adds OAuth-protected MCP at `/mcp`. It does not create or configure the separate `fuel-proxy` Worker.

## Authentication

- MCP clients authenticate through Cloudflare's `@cloudflare/workers-oauth-provider` library.
- Sign-in uses a GitHub OAuth App and is restricted to GitHub account ID `37054791`.
- MCP grants are `fuel:read`, `fuel:write`, and `offline_access`. Writing tools require both read and write grants.
- REST routes continue to require the existing `FUEL_API_TOKEN`.
- Supabase service role access remains server-side.

## Required one-time account setup

1. In GitHub, open **your profile picture → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Enter:
   - Application name: `FUEL ChatGPT`
   - Homepage URL: `https://fuel-chatgpt-api.joshh031.workers.dev`
   - Authorization callback URL: `https://fuel-chatgpt-api.joshh031.workers.dev/callback`
3. Select **Register application**. Copy the **Client ID**, then select **Generate a new client secret**. Keep the secret private.
4. In Cloudflare, open **Workers & Pages → fuel-chatgpt-api → Settings → Variables and Secrets**.
5. Add a text variable named `GITHUB_OAUTH_CLIENT_ID` with the Client ID. Add a secret named `GITHUB_OAUTH_CLIENT_SECRET` with the generated secret. Save the changes.
6. Confirm the existing `FUEL_API_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` secrets, `SUPABASE_URL` variable, and `OAUTH_KV` binding are still attached to this Worker.

Do not paste a secret into GitHub, this README, or ChatGPT.

## Connect this source to the existing Worker

After the OAuth values above are saved, merge the pull request that adds this folder to `main`. Then in Cloudflare:

1. Open **Workers & Pages → fuel-chatgpt-api → Settings → Builds**.
2. Select **Connect** and choose the GitHub repository `Joshh031/fuel`.
3. Set the production branch to `main`.
4. Set **Root directory** to `cloudflare/fuel-chatgpt-api`.
5. Leave **Build command** empty. Set **Deploy command** to `npx wrangler deploy`.
6. Save the connection. Cloudflare will build and deploy the source to the existing Worker. The Worker name in `wrangler.jsonc` is deliberately `fuel-chatgpt-api`.

If Cloudflare asks you to authorize its GitHub app or create a Cloudflare build token, approve that prompt for this repository and Worker.

## Local build check

From `cloudflare/fuel-chatgpt-api`:

```sh
npm ci
npm run dry-run
```

The dry run compiles the Worker without publishing it.

## Checks after deployment

1. Open `https://fuel-chatgpt-api.joshh031.workers.dev/mcp`. Without an OAuth token, the response should be HTTP 401 with an OAuth challenge.
2. Check `https://fuel-chatgpt-api.joshh031.workers.dev/.well-known/oauth-authorization-server` and `https://fuel-chatgpt-api.joshh031.workers.dev/.well-known/oauth-protected-resource`.
3. In ChatGPT, create a custom connector with URL `https://fuel-chatgpt-api.joshh031.workers.dev/mcp`. Choose OAuth. Sign in with the allowed GitHub account and approve the FUEL scopes.
4. Ask ChatGPT to read meals for a known date. Then confirm a small test meal after reviewing its estimate. Verify it in the FUEL app and remove the test meal.

The OAuth consent screen appears for each authorization. If ChatGPT offers connector write permissions, set it to ask before writes.
