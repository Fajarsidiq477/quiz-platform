import { randomUUID } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect } from "vitest";
import * as schema from "@/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

/** In-process Postgres with every real migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite({ extensions: { citext } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  return db;
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  while (cur instanceof Error) {
    parts.push(cur.message);
    cur = cur.cause;
  }
  return parts.join(" | ");
}

/** Asserts the statement fails and that the database error (or its cause chain) matches. */
export async function expectDbError(promise: PromiseLike<unknown>, pattern: RegExp) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected the statement to be rejected").toBeDefined();
  expect(errorText(caught)).toMatch(pattern);
}

/** Runs `fn` with triggers disabled (superuser only), e.g. to backdate timing in tests. */
export async function withoutTriggers<T>(db: TestDb, fn: () => Promise<T>): Promise<T> {
  await db.execute(sql`set session_replication_role = replica`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`set session_replication_role = origin`);
  }
}

export async function seedSchool(db: TestDb) {
  const [school] = await db
    .insert(schema.schools)
    .values({ name: "Test School", slug: `s-${randomUUID()}` })
    .returning();
  const [teacher] = await db
    .insert(schema.users)
    .values({
      schoolId: school.id,
      email: `t-${randomUUID()}@example.test`,
      name: "Teacher",
      role: "teacher",
    })
    .returning();
  const [student] = await db
    .insert(schema.users)
    .values({
      schoolId: school.id,
      email: `s-${randomUUID()}@example.test`,
      name: "Student",
      role: "student",
    })
    .returning();
  const [cls] = await db
    .insert(schema.classes)
    .values({ schoolId: school.id, teacherId: teacher.id, name: "ICT 10A", term: "2026-1" })
    .returning();
  await db
    .insert(schema.enrollments)
    .values({ schoolId: school.id, classId: cls.id, studentId: student.id });
  return { school, teacher, student, cls };
}

export type World = Awaited<ReturnType<typeof seedSchool>>;

/** A published single-choice question version with two options (the second one is correct). */
export async function seedPublishedQuestion(db: TestDb, w: World) {
  const [question] = await db
    .insert(schema.questions)
    .values({ schoolId: w.school.id, createdBy: w.teacher.id, topic: "Networking" })
    .returning();
  const [version] = await db
    .insert(schema.questionVersions)
    .values({
      schoolId: w.school.id,
      questionId: question.id,
      versionNo: 1,
      type: "single_choice",
      prompt: "Which layer routes packets?",
      createdBy: w.teacher.id,
    })
    .returning();
  await db.insert(schema.questionOptions).values([
    { schoolId: w.school.id, questionVersionId: version.id, position: 1, text: "Data link" },
    {
      schoolId: w.school.id,
      questionVersionId: version.id,
      position: 2,
      text: "Network",
      isCorrect: true,
    },
  ]);
  const [published] = await db
    .update(schema.questionVersions)
    .set({ publishedAt: new Date() })
    .where(sql`${schema.questionVersions.id} = ${version.id}`)
    .returning();
  return { question, version: published };
}

/** A published quiz, open right now, with `questionCount` items. */
export async function seedQuiz(
  db: TestDb,
  w: World,
  opts: { questionCount?: number; timeLimitSeconds?: number | null; maxAttempts?: number } = {},
) {
  const { questionCount = 1, timeLimitSeconds = 600, maxAttempts = 1 } = opts;
  const now = Date.now();
  const [quiz] = await db
    .insert(schema.quizzes)
    .values({
      schoolId: w.school.id,
      classId: w.cls.id,
      createdBy: w.teacher.id,
      title: "Networking basics",
      status: "published",
      timeLimitSeconds,
      maxAttempts,
      opensAt: new Date(now - 60 * 60 * 1000),
      closesAt: new Date(now + 60 * 60 * 1000),
    })
    .returning();
  const items = [];
  for (let position = 1; position <= questionCount; position++) {
    const { version } = await seedPublishedQuestion(db, w);
    const [item] = await db
      .insert(schema.quizQuestions)
      .values({
        schoolId: w.school.id,
        quizId: quiz.id,
        questionVersionId: version.id,
        position,
        points: "2",
      })
      .returning();
    items.push(item);
  }
  return { quiz, items };
}

export async function startAttempt(db: TestDb, w: World, quizId: string, attemptNo = 1) {
  const [attempt] = await db
    .insert(schema.attempts)
    .values({ schoolId: w.school.id, quizId, studentId: w.student.id, attemptNo })
    .returning();
  return attempt;
}
