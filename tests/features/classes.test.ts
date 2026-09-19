import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ServiceError } from "@/features/errors";
import {
  createClass,
  deleteClass,
  getClass,
  listClasses,
  updateClass,
} from "@/features/classes/service";
import {
  asAppRole,
  createAppRole,
  createTestDb,
  seedQuiz,
  seedSchool,
  type TestDb,
  type World,
} from "../db/helpers";

describe("classes service", () => {
  let db: TestDb;
  let a: World;
  let b: World;
  const ctx = (w: World) => ({ schoolId: w.school.id, userId: w.teacher.id });
  // Everything runs as the limited role, so row-level security is really in force.
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    a = await seedSchool(db);
    b = await seedSchool(db);
  });

  it("creates a class taught by the signed-in user, and lists it", async () => {
    const created = await as(() => createClass(db, ctx(a), { name: " ICT 11B ", term: "2026-2" }));
    expect(created).toMatchObject({ name: "ICT 11B", term: "2026-2" });

    const [row] = await db.select().from(schema.classes).where(eq(schema.classes.id, created.id));
    expect(row.teacherId).toBe(a.teacher.id);
    expect(row.schoolId).toBe(a.school.id);

    const list = await as(() => listClasses(db, a.school.id));
    expect(list.map((c) => c.name)).toContain("ICT 11B");
    expect(list.find((c) => c.id === created.id)?.quizCount).toBe(0);
  });

  it("refuses a duplicate name in the same term, but allows it in another term", async () => {
    await as(() => createClass(db, ctx(a), { name: "Dup", term: "2026-1" }));
    await expect(
      as(() => createClass(db, ctx(a), { name: "Dup", term: "2026-1" })),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(as(() => createClass(db, ctx(a), { name: "Dup", term: "2026-2" }))).resolves.toBeTruthy();
  });

  it("renames a class, and refuses a rename that collides", async () => {
    const one = await as(() => createClass(db, ctx(a), { name: "Old", term: "2027-1" }));
    await as(() => createClass(db, ctx(a), { name: "Taken", term: "2027-1" }));

    const renamed = await as(() => updateClass(db, ctx(a), one.id, { name: "New", term: "2027-1" }));
    expect(renamed.name).toBe("New");
    await expect(
      as(() => updateClass(db, ctx(a), one.id, { name: "Taken", term: "2027-1" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("deletes an unused class outright", async () => {
    const c = await as(() => createClass(db, ctx(a), { name: "Temp", term: "2028-1" }));
    expect(await as(() => deleteClass(db, ctx(a), c.id))).toBe("deleted");
    expect(await as(() => getClass(db, a.school.id, c.id))).toBeNull();
    expect(await db.select().from(schema.classes).where(eq(schema.classes.id, c.id))).toEqual([]);
  });

  it("archives a class that has quizzes, keeping the quizzes and hiding the class", async () => {
    const { quiz } = await seedQuiz(db, a);
    expect(await as(() => deleteClass(db, ctx(a), a.cls.id))).toBe("archived");

    expect(await as(() => getClass(db, a.school.id, a.cls.id))).toBeNull();
    const list = await as(() => listClasses(db, a.school.id));
    expect(list.map((c) => c.id)).not.toContain(a.cls.id);
    const [stillThere] = await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, quiz.id));
    expect(stillThere).toBeDefined();
  });

  it("counts only a class's own live quizzes", async () => {
    const w = await seedSchool(db);
    await seedQuiz(db, w);
    await seedQuiz(db, w);
    const [row] = await as(() => listClasses(db, w.school.id));
    expect(row.quizCount).toBe(2);
  });

  it("never lets one school see or change another school's classes", async () => {
    const theirs = await as(() => createClass(db, ctx(b), { name: "Secret", term: "2026-1" }));

    expect(await as(() => getClass(db, a.school.id, theirs.id))).toBeNull();
    expect((await as(() => listClasses(db, a.school.id))).map((c) => c.id)).not.toContain(theirs.id);
    await expect(
      as(() => updateClass(db, ctx(a), theirs.id, { name: "Hacked", term: "2026-1" })),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(as(() => deleteClass(db, ctx(a), theirs.id))).rejects.toMatchObject({
      code: "not_found",
    });

    const [unchanged] = await db.select().from(schema.classes).where(eq(schema.classes.id, theirs.id));
    expect(unchanged.name).toBe("Secret");
  });

  it("reports a missing or malformed id as not found", async () => {
    const missing = "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b";
    expect(await as(() => getClass(db, a.school.id, "nope"))).toBeNull();
    for (const id of [missing, "nope"]) {
      const err = await as(() => deleteClass(db, ctx(a), id)).catch((e) => e);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err.code).toBe("not_found");
    }
  });
});
