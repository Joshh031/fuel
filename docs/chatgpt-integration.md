# FUEL ↔ ChatGPT integration (development plan)

## Verified current architecture (2026-10-19)
- Static GitHub Pages application in `index.html`; mobile web/PWA assets `manifest.json` and `sw.js`.
- Supabase REST endpoint called directly by the browser. Public/anon key is embedded in client JS (normal **only if** RLS and policies are correctly configured).
- AI estimates and summaries are routed to a separately deployed Cloudflare Worker (`fuel-proxy.joshh031.workers.dev`) using Claude.
- Meal insert currently uses `meals` fields: `id` (numeric JS timestamp), `date` (YYYY-MM-DD), `meal_type`, `description`, `notes`, `cal`, `prot`, `carb`, `fat`, `fiber`, and `meal_time`.
- Other tables are referenced in the same frontend and must be inventoried before enabling write operations.

## Goal
Let an authorized ChatGPT integration add or correct FUEL entries, with explicit user confirmation, without changing the existing UI or deploying credentials to GitHub Pages.

## Security gate — complete **before deployment**
1. Check Supabase table definitions, RLS enablement and policies, current auth model, and existing users. A public anon key does NOT confer privacy by itself. **Do not turn on API writes until verified.**
2. Keep any service-role credential in a server-side Worker secret, never GitHub or client JS. Prefer scoped per-user Supabase JWT and least privilege where practical.
3. Protect the Worker with a properly authenticated per-user mechanism (OAuth for shareable connector deployments); for private prototype, use a separately stored high-entropy token, rotating/revocable. Do not put tokens in URLs.
4. Enforce strict request validation, date/time handling, allowlisted fields, maximum body size, and idempotent writes. Do not expose other users' records.
5. Maintain an audit trail and prevent duplicate entries from ChatGPT retries.
6. Do not deploy changes to production or alter existing records before a tested staging run.

## Recommended phases
1. **Read-only audit**: Confirm schema, auth/RLS policies, Worker ownership/configuration, and whether FUEL is strictly single-user.
2. **Secure meal API**: Implement and test POST/GET/PATCH/DELETE `/v1/meals`. Explicit confirmation for modifications; guarantee idempotency.
3. **UI refresh**: Refetch `loadDay()` when the browser regains focus or visibility (without discarding in-progress edits); optionally add Supabase Realtime.
4. **Other logs**: Extend API using actual Supabase schemas for water, weight, exercises.
5. **ChatGPT connection**: Publish OpenAPI spec, host OAuth-secured HTTPS endpoint, then connect an Action or custom MCP-based ChatGPT app. A GitHub/Codex connection **alone** will not cause ordinary ChatGPT chat messages to invoke the API.
6. **Cutover**: Run end-to-end tests using a nonproduction account/data set; review a PR, then merge/deploy.

## Acceptance test
- "For lunch I had a turkey sandwich and an apple" → assistant estimates fields → user confirms → authorized API writes exactly one meal.
- Refresh/open FUEL on phone: new meal and changed daily totals appear.
- Resending identical operation/key creates no duplicate.
- Updating/deleting an entry only affects the intended entry after explicit confirmation.
- Unauthorized calls fail; no credentials appear in the GitHub Pages site or public Git history.

## Codex next task
Implement phase 1 audit and phase 2 in this branch, without touching main. Request *specific* Supabase RLS/schema access from the owner if not discoverable; never ask for secret keys in chat or commit them.
