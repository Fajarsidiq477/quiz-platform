import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Any Drizzle Postgres driver (node-postgres in the app, PGlite in tests). */
export type AnyPgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The transaction handed to `withSchool` callbacks. */
export type Tx = Parameters<Parameters<AnyPgDb["transaction"]>[0]>[0];
