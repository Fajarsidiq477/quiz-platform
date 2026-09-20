-- The database login the WEB APP uses, for Neon (or any Postgres).
--
-- Run this once in the Neon SQL Editor, AFTER the migrations, while connected as the owner role.
-- Replace CHANGE_ME_STRONG_PASSWORD first (letters and digits only, so it needs no URL escaping).
--
-- Why a separate role: the platform keeps each school's data apart with row-level security, and
-- Postgres skips that for superusers and for roles with BYPASSRLS. Roles created in the Neon
-- console, CLI or API get BYPASSRLS, so the app must NOT use them. A role created with SQL, like
-- this one, does not. `npm run db:check` tells you whether a connection is safe.

CREATE ROLE quiz_app LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO quiz_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quiz_app;

-- Tables that later migrations create get the same permissions automatically. (This applies to
-- tables created by the role running this script, which is the owner that runs the migrations.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quiz_app;
