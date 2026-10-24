# FUEL access controls

The web app signs the existing owner in through Familyhub Firebase Google authentication. It sends short-lived ID tokens to the `fuel-data` Supabase Edge Function. The function verifies the RS256 signature, issuer, audience, expiry, exact owner UID, verified email and Google provider before accessing any data.

Only the five FUEL nutrition tables are available to the function. Table names, filters, field types, date ranges and request size are validated. Mutations require a single record identifier. Daily water, exercise and weight changes use atomic upserts. Database errors are returned as failures instead of silently appearing successful.

Direct `anon` and `authenticated` table grants are removed. Only the trusted backend retains database access. The existing Cloudflare ChatGPT Worker uses `SUPABASE_SERVICE_ROLE_KEY` and is independent of the web app's Firebase session. Its production configuration must still be verified in Cloudflare; source review alone is not an end-to-end connector test.

Run `node --test tests/fuel-security.test.mjs`. Deploy `supabase/functions/fuel-data` with `verify_jwt=false` because the function verifies Firebase JWTs itself. Never remove the verification inside the function. The Firebase project must authorize `joshh031.github.io` for Google sign-in.

Deploy the function and web app before applying `security/fuel-private-tables.sql`. Verify anonymous/direct authenticated access is denied and service-role reads and writes still succeed. The old Cloudflare AI proxy is a separate security boundary and still requires its own authentication review.
