import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/env";
import * as schema from "./schema";

let pool: Pool | undefined;

/** Lazily created so `next build` and tests do not need DATABASE_URL. */
export function getDb() {
  pool ??= new Pool({ connectionString: getEnv().DATABASE_URL });
  return drizzle(pool, { schema });
}

export { schema };
