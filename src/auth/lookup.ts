import { eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { users } from "@/db/schema";
import type * as schema from "@/db/schema";

type AnyPgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export type UserRecord = {
  id: string;
  schoolId: string;
  email: string;
  name: string;
  role: (typeof users.$inferSelect)["role"];
  status: (typeof users.$inferSelect)["status"];
  archivedAt: Date | null;
};

/** A user plus what is needed to check a password. Only ever used inside the sign-in check. */
export type CredentialsRecord = UserRecord & {
  passwordHash: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};

const userColumns = {
  id: users.id,
  schoolId: users.schoolId,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  archivedAt: users.archivedAt,
};

const credentialColumns = {
  ...userColumns,
  passwordHash: users.passwordHash,
  failedLoginAttempts: users.failedLoginAttempts,
  lockedUntil: users.lockedUntil,
};

type Tx = Parameters<Parameters<AnyPgDb["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction where `app.auth_email` is set, which the `auth_lookup` RLS policy
 * honours: that is how a user is found by email before their school is known (sign-in). The
 * setting is transaction-local, so it never outlives this call.
 */
async function withAuthEmail<T>(
  db: AnyPgDb,
  email: string,
  fn: (tx: Tx, email: string) => Promise<T | undefined>,
): Promise<T | null> {
  const normalized = email.trim();
  if (!normalized) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.auth_email', ${normalized}, true)`);
    return (await fn(tx, normalized)) ?? null;
  });
}

/** Never selects the password hash. */
export function lookupUserByEmail(db: AnyPgDb, email: string): Promise<UserRecord | null> {
  return withAuthEmail(db, email, async (tx, e) => {
    const [row] = await tx.select(userColumns).from(users).where(eq(users.email, e)).limit(1);
    return row;
  });
}

/** Includes the password hash and lockout state, for the sign-in check only. */
export function lookupCredentialsByEmail(
  db: AnyPgDb,
  email: string,
): Promise<CredentialsRecord | null> {
  return withAuthEmail(db, email, async (tx, e) => {
    const [row] = await tx.select(credentialColumns).from(users).where(eq(users.email, e)).limit(1);
    return row;
  });
}

/** Re-reads a signed-in user by id inside their school, to confirm they are still allowed in. */
export async function lookupUserById(
  db: AnyPgDb,
  schoolId: string,
  userId: string,
): Promise<UserRecord | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
    const [row] = await tx.select(userColumns).from(users).where(eq(users.id, userId)).limit(1);
    return row ?? null;
  });
}
