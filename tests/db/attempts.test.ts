import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  expectDbError,
  seedQuiz,
  seedSchool,
  startAttempt,
  withoutTriggers,
  type TestDb,
  type World,
} from "./helpers";

const { attempts, answers, quizzes, enrollments, idempotencyKeys } = schema;

describe("attempts: server-side timer (rule 1)", () => {
  let db: TestDb;
  let w: World;
  beforeAll(async () => {
    db = await createTestDb();
    w = await seedSchool(db);
  });

  it("computes started_at and deadline_at from the database clock, ignoring client values", async () => {
    const { quiz } = await seedQuiz(db, w, { timeLimitSeconds: 600 });
    const bogusStart = new Date("2020-01-01T00:00:00Z");
    const bogusDeadline = new Date("2099-01-01T00:00:00Z");
    const [a] = await db
      .insert(attempts)
      .values({
        schoolId: w.school.id,
        quizId: quiz.id,
        studentId: w.student.id,
        startedAt: bogusStart,
        deadlineAt: bogusDeadline,
      })
      .returning();

    const drift = Math.abs(a.startedAt.getTime() - Date.now());
    expect(drift).toBeLessThan(60_000);
    expect(a.deadlineAt.getTime() - a.startedAt.getTime()).toBe(600_000);
    expect(a.maxScore).toBe("2.00");
    expect(a.status).toBe("in_progress");
  });

  it("caps the deadline at the quiz's closes_at, and uses it for untimed quizzes", async () => {
    const { quiz } = await seedQuiz(db, w, { timeLimitSeconds: 10 * 60 * 60 }); // longer than the window
    const a = await startAttempt(db, w, quiz.id);
    expect(a.deadlineAt.getTime()).toBe(quiz.closesAt!.getTime());

    const untimed = await seedQuiz(db, w, { timeLimitSeconds: null });
    const b = await startAttempt(db, w, untimed.quiz.id);
    expect(b.deadlineAt.getTime()).toBe(untimed.quiz.closesAt!.getTime());
  });

  it("makes started_at and deadline_at immutable", async () => {
    const { quiz } = await seedQuiz(db, w);
    const a = await startAttempt(db, w, quiz.id);
    await expectDbError(
      db.update(attempts).set({ deadlineAt: new Date("2099-01-01T00:00:00Z") }).where(eq(attempts.id, a.id)),
      /identity and timing columns are immutable/,
    );
  });

  it("rejects starting an attempt outside the window, on a draft quiz, or when not enrolled", async () => {
    const { quiz } = await seedQuiz(db, w);

    await db
      .update(quizzes)
      .set({ opensAt: new Date(Date.now() + 3_600_000), closesAt: new Date(Date.now() + 7_200_000) })
      .where(eq(quizzes.id, quiz.id));
    await expectDbError(startAttempt(db, w, quiz.id), /outside its open window/);

    const { quiz: draftQuiz } = await seedQuiz(db, w);
    await db.update(quizzes).set({ status: "closed" }).where(eq(quizzes.id, draftQuiz.id));
    await expectDbError(startAttempt(db, w, draftQuiz.id), /not open for attempts/);

    const other = await seedQuiz(db, w);
    await db.update(enrollments).set({ status: "withdrawn" }).where(eq(enrollments.studentId, w.student.id));
    await expectDbError(startAttempt(db, w, other.quiz.id), /not enrolled/);
    await db.update(enrollments).set({ status: "active" }).where(eq(enrollments.studentId, w.student.id));
  });

  it("rejects attempts beyond max_attempts", async () => {
    const { quiz } = await seedQuiz(db, w, { maxAttempts: 1 });
    await expectDbError(startAttempt(db, w, quiz.id, 2), /max attempts \(1\) exceeded/);
  });

  it("rejects answer writes after the deadline (plus grace) and allows them before", async () => {
    const { quiz, items } = await seedQuiz(db, w);
    const a = await startAttempt(db, w, quiz.id);
    const base = {
      schoolId: w.school.id,
      attemptId: a.id,
      quizId: quiz.id,
      quizQuestionId: items[0].id,
    };
    await db.insert(answers).values({ ...base, response: { text: "on time" } });

    await withoutTriggers(db, () =>
      db.execute(sql`update attempts set started_at = now() - interval '2 hours', deadline_at = now() - interval '1 hour' where id = ${a.id}`),
    );
    await expectDbError(
      db.update(answers).set({ response: { text: "too late" } }).where(eq(answers.attemptId, a.id)),
      /deadline has passed/,
    );
  });

  it("only lets the server expire an attempt once its deadline has passed", async () => {
    const { quiz } = await seedQuiz(db, w);
    const a = await startAttempt(db, w, quiz.id);
    await expectDbError(
      db.update(attempts).set({ status: "expired" }).where(eq(attempts.id, a.id)),
      /before its deadline/,
    );

    await withoutTriggers(db, () =>
      db.execute(sql`update attempts set started_at = now() - interval '2 hours', deadline_at = now() - interval '1 hour' where id = ${a.id}`),
    );
    // Too late to submit normally; only expiry is allowed.
    await expectDbError(
      db.update(attempts).set({ status: "submitted" }).where(eq(attempts.id, a.id)),
      /can only be expired/,
    );
    const [expired] = await db
      .update(attempts)
      .set({ status: "expired" })
      .where(eq(attempts.id, a.id))
      .returning();
    expect(expired.submittedAt).not.toBeNull();
  });
});

describe("attempts: idempotency (rule 2)", () => {
  let db: TestDb;
  let w: World;
  beforeAll(async () => {
    db = await createTestDb();
    w = await seedSchool(db);
  });

  it("allows only one open attempt per student per quiz (duplicate start)", async () => {
    const { quiz } = await seedQuiz(db, w, { maxAttempts: 3 });
    const first = await startAttempt(db, w, quiz.id, 1);
    await expectDbError(startAttempt(db, w, quiz.id, 2), /attempts_one_open_uq/);

    // The idempotent way to start: ON CONFLICT DO NOTHING, then read the existing attempt.
    const retry = await db
      .insert(attempts)
      .values({ schoolId: w.school.id, quizId: quiz.id, studentId: w.student.id, attemptNo: 2 })
      .onConflictDoNothing()
      .returning();
    expect(retry).toEqual([]);
    const open = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.quizId, quiz.id), eq(attempts.status, "in_progress")));
    expect(open.map((a) => a.id)).toEqual([first.id]);
  });

  it("converges on one row when the same answer is saved twice", async () => {
    const { quiz, items } = await seedQuiz(db, w);
    const a = await startAttempt(db, w, quiz.id);
    const save = (text: string) =>
      db
        .insert(answers)
        .values({
          schoolId: w.school.id,
          attemptId: a.id,
          quizId: quiz.id,
          quizQuestionId: items[0].id,
          response: { text },
        })
        .onConflictDoUpdate({
          target: [answers.attemptId, answers.quizQuestionId],
          set: { response: { text } },
        });
    await save("first");
    await save("first"); // replay
    await save("changed my mind");

    const rows = await db.select().from(answers).where(eq(answers.attemptId, a.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].response).toEqual({ text: "changed my mind" });
  });

  it("makes final submit idempotent: the replay matches zero rows and changes nothing", async () => {
    const { quiz } = await seedQuiz(db, w, { maxAttempts: 2 });
    const a = await startAttempt(db, w, quiz.id);
    const submit = () =>
      db
        .update(attempts)
        .set({ status: "submitted" })
        .where(and(eq(attempts.id, a.id), eq(attempts.status, "in_progress")))
        .returning();

    const first = await submit();
    expect(first).toHaveLength(1);
    const replay = await submit();
    expect(replay).toEqual([]);

    const [stored] = await db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(stored.submittedAt).toEqual(first[0].submittedAt);
  });

  it("rejects answer writes and illegal status moves once submitted", async () => {
    const { quiz, items } = await seedQuiz(db, w);
    const a = await startAttempt(db, w, quiz.id);
    await db.update(attempts).set({ status: "submitted" }).where(eq(attempts.id, a.id));

    await expectDbError(
      db.insert(answers).values({
        schoolId: w.school.id,
        attemptId: a.id,
        quizId: quiz.id,
        quizQuestionId: items[0].id,
        response: { text: "after submit" },
      }),
      /not in progress/,
    );
    await expectDbError(
      db.update(attempts).set({ status: "in_progress" }).where(eq(attempts.id, a.id)),
      /illegal status transition/,
    );
    // Grading is the next legal step.
    const [graded] = await db
      .update(attempts)
      .set({ status: "graded", score: "1.00" })
      .where(eq(attempts.id, a.id))
      .returning();
    expect(graded.gradedAt).not.toBeNull();
  });

  it("rejects an answer for a quiz item that belongs to a different quiz", async () => {
    const one = await seedQuiz(db, w);
    const two = await seedQuiz(db, w);
    const a = await startAttempt(db, w, one.quiz.id);
    await expectDbError(
      db.insert(answers).values({
        schoolId: w.school.id,
        attemptId: a.id,
        quizId: one.quiz.id,
        quizQuestionId: two.items[0].id,
        response: { text: "wrong quiz" },
      }),
      /answers_quiz_question_fk/,
    );
  });

  it("does not let grading fields be set when an answer is created", async () => {
    const { quiz, items } = await seedQuiz(db, w);
    const a = await startAttempt(db, w, quiz.id);
    await expectDbError(
      db.insert(answers).values({
        schoolId: w.school.id,
        attemptId: a.id,
        quizId: quiz.id,
        quizQuestionId: items[0].id,
        response: { text: "cheat" },
        isCorrect: true,
        pointsAwarded: "2",
      }),
      /grading fields cannot be set/,
    );
  });

  it("makes idempotency keys replayable and detects key reuse", async () => {
    const key = crypto.randomUUID();
    const row = { schoolId: w.school.id, userId: w.student.id, key, requestHash: "hash-a" };
    const first = await db.insert(idempotencyKeys).values(row).onConflictDoNothing().returning();
    expect(first).toHaveLength(1);
    const replay = await db.insert(idempotencyKeys).values(row).onConflictDoNothing().returning();
    expect(replay).toEqual([]);

    const [stored] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, w.student.id), eq(idempotencyKeys.key, key)));
    // A different request body under the same key is detectable by the hash.
    expect(stored.requestHash).not.toBe("hash-b");
  });
});
