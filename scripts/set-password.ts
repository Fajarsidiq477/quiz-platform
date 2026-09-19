// Usage: npm run user:set-password -- --email student@kbs.sch.id [--password "..."]
// Without --password a random one is generated and printed once. Also clears any login lockout.
// Uses DATABASE_ADMIN_URL (a role that bypasses RLS), falling back to DATABASE_URL.
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProvisionError, setUserPassword } from "@/db/provision";
import * as schema from "@/db/schema";

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, password: { type: "string" } },
  });

  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_ADMIN_URL (or DATABASE_URL) in .env first.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: url });
  try {
    const result = await setUserPassword(
      drizzle(pool, { schema }),
      values.email ?? "",
      values.password,
    );
    console.log(`Password updated (user ${result.userId}).`);
    if (result.temporaryPassword) {
      console.log(`Temporary password (shown once, not stored): ${result.temporaryPassword}`);
    }
  } catch (err) {
    console.error(err instanceof ProvisionError ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
