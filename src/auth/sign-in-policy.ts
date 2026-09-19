import { eq, sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { withSchool } from "@/db/tenant";
import {
  lookupCredentialsByEmail,
  lookupUserById,
  type CredentialsRecord,
  type UserRecord,
} from "./lookup";
import { getDummyHash, loginSchema, verifyPassword } from "./password";
import { isSignInRole, type SignInRole } from "./roles";

type Db = Parameters<typeof lookupCredentialsByEmail>[0];

/** After this many wrong passwords in a row the account is locked for LOCKOUT_MINUTES. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export type AuthUser = {
  id: string;
  schoolId: string;
  email: string;
  name: string;
  role: SignInRole;
};

/**
 * Why a sign-in was refused. The login page shows one generic message for every reason, so a
 * visitor cannot use it to discover which emails are registered; the reason is for logs and tests.
 */
export type SignInDenial = "invalid_credentials" | "locked";

export type SignInResult = { ok: true; user: AuthUser } | { ok: false; reason: SignInDenial };

function toAuthUser(record: UserRecord): AuthUser | null {
  if (record.status !== "active" || record.archivedAt !== null) return null;
  if (!isSignInRole(record.role)) return null;
  return {
    id: record.id,
    schoolId: record.schoolId,
    email: record.email,
    name: record.name,
    role: record.role,
  };
}

/** Atomic, so concurrent guesses cannot slip past the counter. */
async function recordFailure(db: Db, record: CredentialsRecord) {
  // After a lock has expired the count starts again from 1 instead of staying at the threshold.
  const next = sql`(case when ${users.lockedUntil} is not null and ${users.lockedUntil} <= now()
                         then 1 else ${users.failedLoginAttempts} + 1 end)`;
  await withSchool(db, record.schoolId, (tx) =>
    tx
      .update(users)
      .set({
        failedLoginAttempts: next,
        lockedUntil: sql`(case when ${next} >= ${MAX_FAILED_ATTEMPTS}
                               then now() + make_interval(mins => ${LOCKOUT_MINUTES}) else null end)`,
      })
      .where(eq(users.id, record.id)),
  );
}

async function clearFailures(db: Db, record: CredentialsRecord) {
  if (record.failedLoginAttempts === 0 && record.lockedUntil === null) return;
  await withSchool(db, record.schoolId, (tx) =>
    tx
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, record.id)),
  );
}

/**
 * Checks an email and password. Accounts are pre-created by an admin, so an unknown email, a
 * disabled or archived account, and a role that cannot sign in (teacher) are all refused exactly
 * like a wrong password. A password check always runs, even for unknown emails, so the response
 * time does not reveal whether an account exists.
 */
export async function authenticate(db: Db, input: unknown): Promise<SignInResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_credentials" };
  const { email, password } = parsed.data;

  const record = await lookupCredentialsByEmail(db, email);
  const passwordMatches = await verifyPassword(
    password,
    record?.passwordHash ?? (await getDummyHash()),
  );
  if (!record) return { ok: false, reason: "invalid_credentials" };

  // A locked account refuses even the right password, otherwise guessing could still succeed.
  if (record.lockedUntil !== null && record.lockedUntil.getTime() > Date.now()) {
    return { ok: false, reason: "locked" };
  }

  if (!record.passwordHash || !passwordMatches) {
    await recordFailure(db, record);
    return { ok: false, reason: "invalid_credentials" };
  }

  const user = toAuthUser(record);
  if (!user) return { ok: false, reason: "invalid_credentials" };

  await clearFailures(db, record);
  return { ok: true, user };
}

/**
 * Called on every protected request: the signed cookie only says who signed in earlier, so the
 * database decides whether that person is still active and still has the role in the cookie.
 */
export async function loadActiveUser(
  db: Db,
  claims: { uid?: string; schoolId?: string; role?: string },
): Promise<AuthUser | null> {
  if (!claims.uid || !claims.schoolId) return null;
  const record = await lookupUserById(db, claims.schoolId, claims.uid);
  const user = record ? toAuthUser(record) : null;
  return user && user.role === claims.role ? user : null;
}
