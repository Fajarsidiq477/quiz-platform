import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import type * as schema from "./schema";

const schoolIdSchema = z.uuid();

// Any Drizzle Postgres driver (node-postgres in the app, PGlite in tests).
type AnyPgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Runs `fn` in a transaction scoped to one school. Sets `app.school_id` for the transaction only
 * (`set_config(..., true)`), which is what the Row-Level Security policies read. Every tenant
 * query should go through this, and should still filter by `school_id` explicitly: RLS is a
 * backstop, not the primary filter.
 */
export async function withSchool<TDb extends AnyPgDb, T>(
  db: TDb,
  schoolId: string,
  fn: (tx: Parameters<Parameters<TDb["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const id = schoolIdSchema.parse(schoolId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.school_id', ${id}, true)`);
    return fn(tx as Parameters<Parameters<TDb["transaction"]>[0]>[0]);
  });
}
