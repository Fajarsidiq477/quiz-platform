import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/env";
import * as schema from "./schema";

// Cached on globalThis so Next.js hot reloading does not open a new pool on every edit.
const globalForPg = globalThis as unknown as { quizPgPool?: Pool };

/** Lazily created so `next build` and tests do not need DATABASE_URL. */
export function getDb() {
  globalForPg.quizPgPool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
  return drizzle(globalForPg.quizPgPool, { schema });
}

export { schema };
