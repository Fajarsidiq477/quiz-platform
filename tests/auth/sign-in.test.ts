import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { lookupCredentialsByEmail, lookupUserByEmail } from "@/auth/lookup";
import { hashPassword } from "@/auth/password";
import {
  authenticate,
  LOCKOUT_MINUTES,
  loadActiveUser,
  MAX_FAILED_ATTEMPTS,
} from "@/auth/sign-in-policy";
import * as schema from "@/db/schema";
import {
  asAppRole,
  createAppRole,
  createTestDb,
  seedSchool,
  type TestDb,
  type World,
} from "../db/helpers";

const PASSWORD = "correct horse battery";

describe("sign-in lookup under row-level security", () => {
  let db: TestDb;
  let a: World;
  let b: World;
  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    a = await seedSchool(db);
    b = await seedSchool(db);
  });

  it("finds a user by email with no school set (case-insensitive), without the hash", async () => {
    const found = await asAppRole(db, () => lookupUserByEmail(db, a.student.email.toUpperCase()));
    expect(found).toMatchObject({ id: a.student.id, schoolId: a.school.id, role: "student" });
    expect(found).not.toHaveProperty("passwordHash");
  });

  it("only the credentials lookup returns the hash and lockout state", async () => {
    const found = await asAppRole(db, () => lookupCredentialsByEmail(db, a.student.email));
    expect(found).toMatchObject({ id: a.student.id, failedLoginAttempts: 0, lockedUntil: null });
    expect(found).toHaveProperty("passwordHash");
  });

  it("returns null for unknown and blank emails", async () => {
    await asAppRole(db, async () => {
      expect(await lookupUserByEmail(db, "nobody@example.test")).toBeNull();
      expect(await lookupUserByEmail(db, "   ")).toBeNull();
    });
  });

  it("returns only the requested user, never another school's", async () => {
    const found = await asAppRole(db, () => lookupUserByEmail(db, a.teacher.email));
    expect(found?.id).toBe(a.teacher.id);
    expect(found?.id).not.toBe(b.teacher.id);
  });

  it("does not leave the lookup open: with no setting, the app role sees no users", async () => {
    const rows = await asAppRole(db, async () => {
      await lookupUserByEmail(db, a.student.email);
      // The setting was transaction-local, so it is gone again here.
      return db.select().from(schema.users);
    });
    expect(rows).toEqual([]);
  });
});

describe("authenticate", () => {
  let db: TestDb;
  let w: World;
  let admin: typeof schema.users.$inferSelect;
  let hash: string;

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    hash = await hashPassword(PASSWORD);
    w = await seedSchool(db);
    [admin] = await db
      .insert(schema.users)
      .values({ schoolId: w.school.id, email: "admin@kbs.sch.id", name: "Admin", role: "admin" })
      .returning();
    await db.update(schema.users).set({ passwordHash: hash }); // everyone shares one password here
  });

  const login = (email: string, password: string) =>
    asAppRole(db, () => authenticate(db, { email, password }));

  const counters = async (id: string) => {
    const [row] = await db
      .select({
        failed: schema.users.failedLoginAttempts,
        lockedUntil: schema.users.lockedUntil,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    return row;
  };

  const reset = (id: string) =>
    db
      .update(schema.users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, status: "active", archivedAt: null })
      .where(eq(schema.users.id, id));

  const invalid = { ok: false, reason: "invalid_credentials" };

  it("admits a registered student and admin, ignoring email case", async () => {
    const student = await login(w.student.email.toUpperCase(), PASSWORD);
    expect(student).toEqual({
      ok: true,
      user: {
        id: w.student.id,
        schoolId: w.school.id,
        email: w.student.email,
        name: "Student",
        role: "student",
      },
    });
    const adminResult = await login("Admin@KBS.sch.id", PASSWORD);
    expect(adminResult).toMatchObject({ ok: true, user: { id: admin.id, role: "admin" } });
    // The result never carries the hash.
    expect(JSON.stringify(adminResult)).not.toContain("scrypt");
  });

  it("refuses a wrong password, an unknown email and an account with no password set", async () => {
    expect(await login(w.student.email, "wrong password")).toEqual(invalid);
    expect(await login("stranger@example.test", PASSWORD)).toEqual(invalid);

    await db.update(schema.users).set({ passwordHash: null }).where(eq(schema.users.id, w.student.id));
    expect(await login(w.student.email, PASSWORD)).toEqual(invalid);
    await db.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, w.student.id));
    await reset(w.student.id);
  });

  it("refuses malformed input without touching the database", async () => {
    for (const input of [null, {}, { email: "x" }, { email: "a@b.test", password: "" }, "text"]) {
      expect(await asAppRole(db, () => authenticate(db, input))).toEqual(invalid);
    }
  });

  it("refuses teachers, disabled and archived accounts even with the right password", async () => {
    expect(await login(w.teacher.email, PASSWORD)).toEqual(invalid);

    await db.update(schema.users).set({ status: "disabled" }).where(eq(schema.users.id, w.student.id));
    expect(await login(w.student.email, PASSWORD)).toEqual(invalid);
    await reset(w.student.id);

    await db.update(schema.users).set({ archivedAt: new Date() }).where(eq(schema.users.id, w.student.id));
    expect(await login(w.student.email, PASSWORD)).toEqual(invalid);
    await reset(w.student.id);

    expect((await login(w.student.email, PASSWORD)).ok).toBe(true);
  });

  it("counts failures, and a success clears them", async () => {
    await login(w.student.email, "nope");
    await login(w.student.email, "nope");
    expect((await counters(w.student.id)).failed).toBe(2);
    expect((await login(w.student.email, PASSWORD)).ok).toBe(true);
    expect(await counters(w.student.id)).toEqual({ failed: 0, lockedUntil: null });
  });

  it("locks the account after too many failures and then refuses even the right password", async () => {
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(await login(w.student.email, "nope")).toEqual(invalid);
      expect((await counters(w.student.id)).lockedUntil).toBeNull();
    }
    // The failure that reaches the limit locks the account.
    expect(await login(w.student.email, "nope")).toEqual(invalid);
    const locked = await counters(w.student.id);
    expect(locked.failed).toBe(MAX_FAILED_ATTEMPTS);
    const minutesLeft = (locked.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(LOCKOUT_MINUTES - 1);
    expect(minutesLeft).toBeLessThanOrEqual(LOCKOUT_MINUTES);

    expect(await login(w.student.email, PASSWORD)).toEqual({ ok: false, reason: "locked" });
    // While locked, further guesses do not extend the lock or grow the counter.
    await login(w.student.email, "nope");
    expect(await counters(w.student.id)).toEqual(locked);

    // Other accounts are unaffected.
    expect((await login("admin@kbs.sch.id", PASSWORD)).ok).toBe(true);
  });

  it("lets the account in again once the lock has expired, and restarts the count", async () => {
    const expire = () =>
      db
        .update(schema.users)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(schema.users.id, w.student.id));

    await expire();
    // A wrong guess after expiry starts counting from 1 again instead of locking immediately.
    expect(await login(w.student.email, "nope")).toEqual(invalid);
    expect(await counters(w.student.id)).toEqual({ failed: 1, lockedUntil: null });

    await db
      .update(schema.users)
      .set({ failedLoginAttempts: MAX_FAILED_ATTEMPTS })
      .where(eq(schema.users.id, w.student.id));
    await expire();
    expect((await login(w.student.email, PASSWORD)).ok).toBe(true);
    expect(await counters(w.student.id)).toEqual({ failed: 0, lockedUntil: null });
  });
});

describe("loadActiveUser (per-request re-check)", () => {
  let db: TestDb;
  let w: World;
  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
  });

  const load = (claims: Parameters<typeof loadActiveUser>[1]) =>
    asAppRole(db, () => loadActiveUser(db, claims));

  it("accepts matching claims", async () => {
    const user = await load({ uid: w.student.id, schoolId: w.school.id, role: "student" });
    expect(user?.id).toBe(w.student.id);
  });

  it("rejects missing claims, a wrong role, and the wrong school", async () => {
    expect(await load({})).toBeNull();
    expect(await load({ uid: w.student.id, schoolId: w.school.id, role: "admin" })).toBeNull();
    const other = await seedSchool(db);
    expect(
      await load({ uid: w.student.id, schoolId: other.school.id, role: "student" }),
    ).toBeNull();
  });

  it("stops honouring a valid cookie once the account is disabled", async () => {
    const claims = { uid: w.student.id, schoolId: w.school.id, role: "student" };
    expect(await load(claims)).not.toBeNull();
    await db
      .update(schema.users)
      .set({ status: "disabled" })
      .where(eq(schema.users.id, w.student.id));
    expect(await load(claims)).toBeNull();
  });
});
