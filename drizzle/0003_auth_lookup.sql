-- Sign-in happens before the school is known, so the per-school RLS policy hides every user row.
-- This extra SELECT-only policy lets a transaction that has set `app.auth_email` see exactly the
-- row(s) with that email (email is unique, so at most one). It grants no write access and no way
-- to list other users. Policies are OR-ed, so the tenant_isolation policy is unaffected.
-- The setting is transaction-local (see src/auth/lookup.ts).
CREATE POLICY auth_lookup ON users
  FOR SELECT
  USING (email = nullif(current_setting('app.auth_email', true), '')::citext);
