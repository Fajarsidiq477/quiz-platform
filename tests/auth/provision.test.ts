import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyPassword } from "@/auth/password";
import { ProvisionError, provisionUser, setUserPassword } from "@/db/provision";
import * as schema from "@/db/schema";
import { createTestDb, type TestDb } from "../db/helpers";

describe("provisionUser", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });

  const userByEmail = async (email: string) => {
    const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    return row;
  };

  it("creates the school with its first admin, then adds a student to the same school", async () => {
    const first = await provisionUser(db, {
      schoolSlug: "KBS",
      schoolName: "KBS School",
      email: "  Admin@KBS.sch.id ",
      name: "Admin",
      role: "admin",
      password: "an admin password",
    });
    expect(first.createdSchool).toBe(true);
    expect(first.temporaryPassword).toBeUndefined(); // the caller chose it, so nothing to hand out

    const second = await provisionUser(db, {
      schoolSlug: "kbs",
      email: "student1@kbs.sch.id",
      name: "Student One",
      role: "student",
    });
    expect(second.createdSchool).toBe(false);
    expect(second.schoolId).toBe(first.schoolId);

    const admin = await userByEmail("admin@kbs.sch.id");
    expect(admin).toMatchObject({ id: first.userId, role: "admin", status: "active" });
  });

  it("stores only a hash of the password", async () => {
    const admin = await userByEmail("admin@kbs.sch.id");
    expect(admin.passwordHash).toMatch(/^scrypt\$/);
    expect(admin.passwordHash).not.toContain("an admin password");
    expect(await verifyPassword("an admin password", admin.passwordHash!)).toBe(true);
  });

  it("generates a one-time password when none is given, and it works", async () => {
    const result = await provisionUser(db, {
      schoolSlug: "kbs",
      email: "student2@kbs.sch.id",
      name: "Student Two",
      role: "student",
    });
    expect(result.temporaryPassword).toHaveLength(12);
    const user = await userByEmail("student2@kbs.sch.id");
    expect(await verifyPassword(result.temporaryPassword!, user.passwordHash!)).toBe(true);
  });

  it("refuses a duplicate email, even in a different case", async () => {
    await expect(
      provisionUser(db, {
        schoolSlug: "kbs",
        email: "STUDENT1@kbs.sch.id",
        name: "Again",
        role: "student",
      }),
    ).rejects.toThrow(ProvisionError);
  });

  it("refuses an unknown school when no name is given, and creates nothing", async () => {
    await expect(
      provisionUser(db, { schoolSlug: "missing", email: "x@y.test", name: "X", role: "student" }),
    ).rejects.toThrow(/does not exist/);
    const rows = await db.select().from(schema.schools).where(eq(schema.schools.slug, "missing"));
    expect(rows).toEqual([]);
  });

  it("validates input: slug, email, role and password length", async () => {
    const ok = { schoolSlug: "kbs", email: "v@kbs.sch.id", name: "V", role: "student" as const };
    await expect(provisionUser(db, { ...ok, schoolSlug: "bad slug" })).rejects.toThrow();
    await expect(provisionUser(db, { ...ok, email: "nope" })).rejects.toThrow();
    await expect(provisionUser(db, { ...ok, role: "teacher" as "admin" })).rejects.toThrow();
    await expect(provisionUser(db, { ...ok, password: "short" })).rejects.toThrow();
    expect(await userByEmail("v@kbs.sch.id")).toBeUndefined();
  });
});

describe("setUserPassword", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await provisionUser(db, {
      schoolSlug: "kbs",
      schoolName: "KBS",
      email: "s@kbs.sch.id",
      name: "S",
      role: "student",
      password: "the first password",
    });
  });

  it("replaces the password, and clears any lockout", async () => {
    await db
      .update(schema.users)
      .set({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(schema.users.email, "s@kbs.sch.id"));

    const result = await setUserPassword(db, " S@KBS.sch.id ", "the second password");
    expect(result.temporaryPassword).toBeUndefined();

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, result.userId));
    expect(user).toMatchObject({ failedLoginAttempts: 0, lockedUntil: null });
    expect(await verifyPassword("the second password", user.passwordHash!)).toBe(true);
    expect(await verifyPassword("the first password", user.passwordHash!)).toBe(false);
  });

  it("generates a password when none is given", async () => {
    const result = await setUserPassword(db, "s@kbs.sch.id");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, result.userId));
    expect(await verifyPassword(result.temporaryPassword!, user.passwordHash!)).toBe(true);
  });

  it("rejects an unknown email and a weak password", async () => {
    await expect(setUserPassword(db, "nobody@kbs.sch.id", "long enough password")).rejects.toThrow(
      ProvisionError,
    );
    await expect(setUserPassword(db, "s@kbs.sch.id", "short")).rejects.toThrow();
  });
});
