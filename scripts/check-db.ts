// Usage: npm run db:check
// Says whether DATABASE_URL is safe to give the web app. Read-only: it only runs SELECTs.
// To check the connection you intend to put on the server, pass it for this one command:
//   PowerShell:  $env:DATABASE_URL="postgres://..." ; npm run db:check
import { Pool } from "pg";
import { assessRole } from "./check-db-lib";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL (in .env, or for this command only) first.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `select current_user as name, r.rolsuper, r.rolbypassrls
         from pg_roles r where r.rolname = current_user`,
    );
    const role = { name: rows[0].name, superuser: rows[0].rolsuper, bypassRls: rows[0].rolbypassrls };

    const exists = await pool.query<{ ok: boolean }>(`select to_regclass('public.users') is not null as ok`);
    const tablesExist = exists.rows[0].ok;

    // With no school selected, row-level security should hide every row from a limited role.
    let visible: number | null = null;
    if (tablesExist) {
      try {
        visible = (await pool.query<{ n: number }>(`select count(*)::int as n from users`)).rows[0].n;
      } catch {
        visible = null; // no permission on the table
      }
    }

    const result = assessRole(role, visible, tablesExist);
    console.log(`Connected as "${role.name}" (superuser: ${role.superuser}, bypass RLS: ${role.bypassRls}).`);
    for (const note of result.notes) console.log(`  note: ${note}`);
    if (result.ok) {
      console.log("OK: this connection is safe for the web app (schools are kept apart).");
    } else {
      for (const problem of result.problems) console.error(`  PROBLEM: ${problem}`);
      console.error("NOT SAFE for the web app. (It is fine for migrations and admin scripts.)");
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
