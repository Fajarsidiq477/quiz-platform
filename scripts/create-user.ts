// Usage: npm run user:create -- --school-slug kbs --school-name "KBS" \
//          --email teacher@kbs.sch.id --name "Full Name" --role admin [--password "..."]
// Without --password a random one is generated and printed once.
// Uses DATABASE_ADMIN_URL (a role that bypasses RLS), falling back to DATABASE_URL.
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ProvisionError, provisionUser } from "@/db/provision";
import * as schema from "@/db/schema";

async function main() {
  const { values } = parseArgs({
    options: {
      "school-slug": { type: "string" },
      "school-name": { type: "string" },
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      password: { type: "string" },
    },
  });

  const url = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_ADMIN_URL (or DATABASE_URL) in .env first.");
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: url });
  try {
    const result = await provisionUser(drizzle(pool, { schema }), {
      schoolSlug: values["school-slug"] ?? "",
      schoolName: values["school-name"],
      email: values.email ?? "",
      name: values.name ?? "",
      role: values.role as "student" | "admin",
      password: values.password,
    });
    console.log(
      `${result.createdSchool ? "Created school and user" : "Created user"} (user ${result.userId}).`,
    );
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
