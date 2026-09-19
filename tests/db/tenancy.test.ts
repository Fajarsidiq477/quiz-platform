import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { withSchool } from "@/db/tenant";
import { createTestDb, expectDbError, seedSchool, type TestDb } from "./helpers";

describe("tenant isolation (rule 4)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.execute(sql`create role app_user`);
    await db.execute(sql`grant usage on schema public to app_user`);
    await db.execute(sql`grant all on all tables in schema public to app_user`);
  });

  it("rejects a child row that points at a parent in another school", async () => {
    const a = await seedSchool(db);
    const b = await seedSchool(db);
    // Class in school A, taught by a teacher of school B.
    await expectDbError(
      db.insert(schema.classes).values({
        schoolId: a.school.id,
        teacherId: b.teacher.id,
        name: "Bad class",
        term: "2026-1",
      }),
      /classes_teacher_fk/,
    );
    // Enrolling school B's student into school A's class.
    await expectDbError(
      db.insert(schema.enrollments).values({
        schoolId: a.school.id,
        classId: a.cls.id,
        studentId: b.student.id,
      }),
      /enrollments_student_fk/,
    );
  });

  it("makes every core table carry a school_id", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and t.table_name not in ('schools', '__drizzle_migrations')
        and not exists (
          select 1 from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'school_id'
        )
    `);
    expect(result.rows).toEqual([]);
  });

  it("row-level security shows a session only its own school's rows", async () => {
    const a = await seedSchool(db);
    const b = await seedSchool(db);

    const seenByA = await withSchool(db, a.school.id, async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select({ id: schema.users.id }).from(schema.users);
    });
    const ids = seenByA.map((u) => u.id);
    expect(ids).toContain(a.teacher.id);
    expect(ids).toContain(a.student.id);
    expect(ids).not.toContain(b.teacher.id);
    expect(ids).not.toContain(b.student.id);
  });

  it("row-level security fails closed when no school is set", async () => {
    await seedSchool(db);
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`set local role app_user`);
      return tx.select().from(schema.users);
    });
    expect(rows).toEqual([]);
  });

  it("row-level security rejects writing into another school", async () => {
    const a = await seedSchool(db);
    const b = await seedSchool(db);
    await expectDbError(
      withSchool(db, a.school.id, async (tx) => {
        await tx.execute(sql`set local role app_user`);
        await tx.insert(schema.classes).values({
          schoolId: b.school.id,
          teacherId: b.teacher.id,
          name: "Injected",
          term: "2026-1",
        });
      }),
      /row-level security/,
    );
    const injected = await db.select().from(schema.classes).where(eq(schema.classes.name, "Injected"));
    expect(injected).toEqual([]);
  });
});
