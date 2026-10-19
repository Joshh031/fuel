# Security finding — 2026-10-19

Owner-provided Supabase dashboard screenshots, FUEL project ID vphqjxjphdsdpqaxqkpf.

**Confirmed:** `public.meals` permissive policy named `allow all`, command ALL, roles public, USING (true), WITH CHECK (true). RLS is enabled but this policy does not restrict anon access. Existing public index.html embeds the Supabase anon/publishable key and uses it for direct REST requests. As a consequence meal data is likely accessible and writable by unauthenticated parties using this API key.

**Other screenshot observations:** `exercise_log` shows ALL/public policy named `Allow all`, but exact predicates have not been inspected. `push_subs` has RLS DISABLED; inspect grants and contents, treat as potentially exposed. Assess remaining tables.

## Non-disruptive remediation plan
1. Inventory table definitions, grants, policies and client auth behavior; back up database before any changes. Do not publish records or secrets.
2. Add Supabase Auth (single-user) to FUEL or route client accesses through a securely authenticated backend. Consider migration of historical records to a user_id ownership model. Test on staging.
3. Scope RLS policies to authenticated user `auth.uid()` and explicitly revoke anon write/read where appropriate. Treat push subscription endpoints as sensitive.
4. Validate all existing functionality and external integrations prior to removing permissive policies; prepare rollback.
5. API for ChatGPT should authenticate calls and enforce authorization; don't trust public anon keys.
6. Rotate compromised secrets only if service-role/secret credentials are found exposed; anon key rotation alone does not fix permissive RLS. Consider access logs for anomalous activity.

**Do not change production RLS yet:** the current app depends on direct anonymous REST calls, so immediate denial would break FUEL.
