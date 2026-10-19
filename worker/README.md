# Deploying the separate FUEL ChatGPT API

This is a **development prototype**, not deployed. It does not replace the existing `fuel-proxy` Claude Worker.

## Requirements
- Cloudflare account authorized to deploy Workers.
- A privately generated long random `FUEL_API_TOKEN` (at least 32 random bytes).
- Supabase **service role** key stored as a Cloudflare Worker **secret**, never sent in chat or committed to GitHub.
- Scope: single-user meals API only; water, weight and exercise are follow-on work. Existing anonymous table access has not yet been remediated.

## Deploy (once reviewed)
1. From the `worker/` directory run `npx wrangler login` then `npx wrangler deploy`.
2. Run `npx wrangler secret put FUEL_API_TOKEN` and paste your generated token.
3. Run `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and paste the Supabase secret key locally.
4. Check both secrets are configured in Cloudflare Worker settings; undeployed or missing secrets return 503.
5. Test GET for an existing date using a locally held Bearer token. Then test one new meal with an idempotency key, retry, edit and delete.
6. Never put a service role key or FUEL_API_TOKEN in the browser, chat transcript, Codex prompt, or GitHub repository.

## Notes
- This service uses a single high-entropy Bearer token, adequate for a private prototype but **not** sufficient by itself for direct ChatGPT connector sign-in. For ChatGPT actions/apps, create an OAuth/token-broker layer rather than paste long-lived service credentials into a public connector.
- `POST /v1/meals` requires `Idempotency-Key`; its deterministic numeric ID is namespaced separately from FUEL's Date.now() IDs.
- User must review and explicitly confirm meal estimates before writes.
- Supabase schema must be checked before deployment. Database permissions allowing anonymous writes remain a separate issue.
- Implement no production deployment until a backup and successful staging smoke tests.
