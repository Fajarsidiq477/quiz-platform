import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticate } from "@/auth/sign-in-policy";
import * as schema from "@/db/schema";
import type { Ctx } from "@/features/errors";
import { setJoinCode } from "@/features/classes/service";
import { questionInputSchema, type QuizInput } from "@/features/quizzes/schemas";
import { addQuestion, createQuiz, publishQuiz } from "@/features/quizzes/service";
import { importQuizFromExcel } from "@/features/quiz-import/service";
import { buildTemplate } from "@/features/quiz-import/template";
import { registerStudent } from "@/features/register/service";
import { deleteStudentResult, getQuizResults } from "@/features/results/service";
import { reportAway } from "@/features/student/away";
import { saveAnswer, startAttempt, submitAttempt } from "@/features/student/service";
import { createTestDb, seedSchool, type TestDb, type World } from "./helpers";

// The Neon guide gives the reader `docs/neon-app-role.sql`. This runs that exact file, then drives
// the platform's main flows as the role it creates, so the guide cannot promise a role that is too
// weak to work or (worse) too strong to keep schools apart.

const HOUR = 3_600_000;
const SQL_FILE = readFileSync(path.resolve(import.meta.dirname, "../../docs/neon-app-role.sql"), "utf8");

/** The statements of the SQL file, comments removed, with the password placeholder filled in. */
function statements(): string[] {
  return SQL_FILE.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace("CHANGE_ME_STRONG_PASSWORD", "test-password-123")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("the app role from docs/neon-app-role.sql", () => {
  let db: TestDb;
  let w: World;
  let admin: Ctx;
  let student: Ctx;

  /** Runs `fn` as the app role, then back as the superuser. */
  const app = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.execute(sql`set role quiz_app`);
    try {
      return await fn();
    } finally {
      await db.execute(sql`reset role`);
    }
  };

  beforeAll(async () => {
    db = await createTestDb(); // the real migrations, as the owner would have run them
    for (const statement of statements()) await db.execute(sql.raw(statement));
    w = await seedSchool(db);
    admin = { schoolId: w.school.id, userId: w.teacher.id };
    student = { schoolId: w.school.id, userId: w.student.id };
  });

  const quizInput = (): QuizInput => ({
    title: "Networking",
    description: null,
    classId: w.cls.id,
    timeLimitMinutes: 30,
    opensAt: new Date(Date.now() - HOUR),
    closesAt: new Date(Date.now() + 24 * HOUR),
    maxAttempts: 2,
    shuffleQuestions: false,
    resultsVisibility: "after_close",
  });

  it("is a limited role: not a superuser, and it cannot skip row-level security", async () => {
    const [role] = (
      await db.execute<{ rolsuper: boolean; rolbypassrls: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolcanlogin: boolean }>(
        sql`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin from pg_roles where rolname = 'quiz_app'`,
      )
    ).rows;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true });
  });

  it("sees nothing until a school is selected, and only that school afterwards", async () => {
    const other = await seedSchool(db); // a second school with its own users
    const none = await app(() => db.select().from(schema.users));
    expect(none).toEqual([]);

    const mine = await app(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.school_id', ${w.school.id}, true)`);
        return tx.select().from(schema.users);
      }),
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((u) => u.schoolId === w.school.id)).toBe(true);
    expect(mine.some((u) => u.schoolId === other.school.id)).toBe(false);
  });

  it("can run a whole quiz: build it, take it, grade it, read the results, delete one", async () => {
    const { id } = await app(() => createQuiz(db, admin, quizInput()));
    await app(() =>
      addQuestion(db, admin, id, questionInputSchema.parse({ type: "true_false", prompt: "A switch works at layer 2.", points: "1", correct: true })),
    );
    await app(() => publishQuiz(db, admin, id));

    const { attemptId } = await app(() => startAttempt(db, student, id));
    const [item] = await db.select().from(schema.quizQuestions).where(eq(schema.quizQuestions.quizId, id));
    await app(() => saveAnswer(db, student, attemptId, item.id, { optionIds: [] }).catch(() => undefined));
    await app(() => reportAway(db, student, attemptId, "hidden"));
    await app(() => submitAttempt(db, student, attemptId, {}));

    const results = (await app(() => getQuizResults(db, admin, id)))!;
    expect(results.summary.finished).toBe(1);
    expect(results.rows.find((r) => r.studentId === w.student.id)?.away?.count).toBe(1);

    await app(() => deleteStudentResult(db, admin, id, w.student.id));
    expect(await db.select().from(schema.attempts).where(eq(schema.attempts.quizId, id))).toEqual([]);
  });

  it("can import a quiz from Excel", async () => {
    const parsed = quizInput();
    const result = await app(async () => importQuizFromExcel(db, admin, parsed, new Uint8Array(await buildTemplate())));
    expect(result).toMatchObject({ ok: true, questionCount: 4 });
  });

  it("can register a student with a class code and sign them in (the two lookups before a school is known)", async () => {
    const code = (await app(() => setJoinCode(db, admin, w.cls.id, "generate")))!;
    const registered = await app(() =>
      registerStudent(db, { name: "New Student", email: "new.student@example.test", password: "a-good-password", confirmPassword: "a-good-password", code }),
    );
    expect(registered).toBeTruthy();

    const signedIn = await app(() => authenticate(db, { email: "new.student@example.test", password: "a-good-password" }));
    expect(signedIn.ok).toBe(true);
    const wrong = await app(() => authenticate(db, { email: "new.student@example.test", password: "not-the-password" }));
    expect(wrong.ok).toBe(false);
  });

  it("gets the same permissions on tables that later migrations create", async () => {
    await db.execute(sql`create table later_migration_table (id int primary key, school_id uuid)`);
    await db.execute(sql`insert into later_migration_table values (1, null)`);
    const rows = await app(() => db.execute(sql`select id from later_migration_table`));
    expect(rows.rows).toEqual([{ id: 1 }]);
  });

  it("cannot change the schema", async () => {
    await expect(app(() => db.execute(sql`create table sneaky (id int)`))).rejects.toThrow();
    await expect(app(() => db.execute(sql`drop table answers`))).rejects.toThrow();
    await expect(app(() => db.execute(sql`create role another_role`))).rejects.toThrow();
  });
});
