-- A student registering types a class join code before any school is known, so the per-school RLS
-- policy hides every class row. This extra SELECT-only policy lets a transaction that has set
-- `app.join_code` see exactly the class with that code (codes are unique, and a null code never
-- matches). It grants no write access and no way to list classes. Policies are OR-ed, so the
-- tenant_isolation policy is unaffected. The setting is transaction-local
-- (see src/features/register/service.ts).
CREATE POLICY join_code_lookup ON classes
  FOR SELECT
  USING (join_code = nullif(current_setting('app.join_code', true), ''));
