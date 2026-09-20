import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ServiceError, type Ctx } from "@/features/errors";
import { questionInputSchema, type QuizInput } from "@/features/quizzes/schemas";
import {
  addQuestion,
  createQuiz,
  getQuiz,
  publishQuiz,
  unpublishQuiz,
  type QuizItem,
} from "@/features/quizzes/service";
import { deleteStudentResult, getQuizResults } from "@/features/results/service";
import { startAttempt, submitAttempt } from "@/features/student/service";
import { asAppRole, createAppRole, createTestDb, seedSchool, type TestDb, type World } from "../db/helpers";

const HOUR = 3_600_000;

describe("deleting a student's result", () => {
  let db: TestDb;
  let w: World;
  let admin: Ctx;
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
    admin = { schoolId: w.school.id, userId: w.teacher.id };
  });

  const quizInput = (over: Partial<QuizInput> = {}): QuizInput => ({
    title: "Networking",
    description: null,
    classId: w.cls.id,
    timeLimitMinutes: 30,
    opensAt: new Date(Date.now() - HOUR),
    closesAt: new Date(Date.now() + 24 * HOUR),
    maxAttempts: 2,
    shuffleQuestions: false,
    resultsVisibility: "after_close",
    ...over,
  });
  const question = questionInputSchema.parse({
    type: "single_choice",
    prompt: "Which layer routes packets?",
    points: "1",
    options: [
      { text: "Data link", isCorrect: false },
      { text: "Network", isCorrect: true },
    ],
  });

  async function publishedQuiz() {
    const { id } = await as(() => createQuiz(db, admin, quizInput()));
    await as(() => addQuestion(db, admin, id, question));
    await as(() => publishQuiz(db, admin, id));
    return id;
  }
  const items = async (quizId: string): Promise<QuizItem[]> =>
    (await as(() => getQuiz(db, admin.schoolId, quizId)))!.items;

  async function addStudent(name: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ schoolId: w.school.id, email: `${name}-${Math.random().toString(36).slice(2, 7)}@example.test`, name, role: "student" })
      .returning();
    await db.insert(schema.enrollments).values({ schoolId: w.school.id, classId: w.cls.id, studentId: user.id });
    return { id: user.id, ctx: { schoolId: w.school.id, userId: user.id } as Ctx };
  }

  /** Starts an attempt and, unless `leaveOpen`, answers correctly and hands in. */
  async function attempt(who: Ctx, quizId: string, leaveOpen = false) {
    const { attemptId } = await as(() => startAttempt(db, who, quizId));
    if (!leaveOpen) {
      const [item] = await items(quizId);
      const snapshot = { [item.id]: { optionIds: item.options.filter((o) => o.isCorrect).map((o) => o.id) } };
      await as(() => submitAttempt(db, who, attemptId, snapshot));
    }
    return attemptId;
  }
  const attemptsOf = (studentId: string) =>
    db.select().from(schema.attempts).where(eq(schema.attempts.studentId, studentId));
  const answersOf = (attemptIds: string[]) =>
    attemptIds.length === 0
      ? Promise.resolve([])
      : db.select().from(schema.answers).where(inArray(schema.answers.attemptId, attemptIds));

  async function failsWith(promise: Promise<unknown>, message: RegExp) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).message).toMatch(message);
    expect((error as ServiceError).code).toBe("not_found");
  }

  it("removes every attempt and answer of that student, and only theirs", async () => {
    const quizId = await publishedQuiz();
    const ani = await addStudent("Ani");
    const budi = await addStudent("Budi");
    const aniAttempts = [await attempt(ani.ctx, quizId), await attempt(ani.ctx, quizId)];
    const budiAttempt = await attempt(budi.ctx, quizId);
    expect((await answersOf(aniAttempts)).length).toBe(2);

    const out = await as(() => deleteStudentResult(db, admin, quizId, ani.id));

    expect(out).toEqual({ attemptsDeleted: 2 });
    expect(await attemptsOf(ani.id)).toEqual([]);
    expect(await answersOf(aniAttempts)).toEqual([]);
    // Budi is untouched.
    expect((await attemptsOf(budi.id)).map((a) => a.id)).toEqual([budiAttempt]);
    expect((await answersOf([budiAttempt])).length).toBe(1);

    const results = (await as(() => getQuizResults(db, admin, quizId)))!;
    const row = (id: string) => results.rows.find((r) => r.studentId === id)!;
    expect(row(ani.id)).toMatchObject({ state: "not_started", attemptsUsed: 0, latest: null });
    expect(row(budi.id)).toMatchObject({ state: "finished", attemptsUsed: 1 });
    expect(results.summary.finished).toBe(1);
  });

  it("lets the student start over, from attempt 1", async () => {
    const quizId = await publishedQuiz();
    const cami = await addStudent("Cami");
    await attempt(cami.ctx, quizId);
    await attempt(cami.ctx, quizId); // both attempts used: cannot start a third
    await expect(as(() => startAttempt(db, cami.ctx, quizId))).rejects.toThrow();

    await as(() => deleteStudentResult(db, admin, quizId, cami.id));

    const fresh = await as(() => startAttempt(db, cami.ctx, quizId));
    const [row] = await db.select().from(schema.attempts).where(eq(schema.attempts.id, fresh.attemptId));
    expect(row.attemptNo).toBe(1);
  });

  it("also deletes an attempt that is still in progress", async () => {
    const quizId = await publishedQuiz();
    const dewi = await addStudent("Dewi");
    await attempt(dewi.ctx, quizId, true);

    const results = (await as(() => getQuizResults(db, admin, quizId)))!;
    expect(results.rows.find((r) => r.studentId === dewi.id)).toMatchObject({ state: "in_progress", attemptsUsed: 1 });

    expect(await as(() => deleteStudentResult(db, admin, quizId, dewi.id))).toEqual({ attemptsDeleted: 1 });
    expect(await attemptsOf(dewi.id)).toEqual([]);
  });

  it("unfreezes the quiz once its last result is gone", async () => {
    const quizId = await publishedQuiz();
    const eka = await addStudent("Eka");
    const fajar = await addStudent("Fajar");
    await attempt(eka.ctx, quizId);
    await attempt(fajar.ctx, quizId);
    await expect(as(() => unpublishQuiz(db, admin, quizId))).rejects.toThrow(/already started/);

    await as(() => deleteStudentResult(db, admin, quizId, eka.id));
    // One result left: still frozen.
    await expect(as(() => unpublishQuiz(db, admin, quizId))).rejects.toThrow(/already started/);

    await as(() => deleteStudentResult(db, admin, quizId, fajar.id));
    await as(() => unpublishQuiz(db, admin, quizId));
    // Back to a draft, so the questions can change again.
    await as(() => addQuestion(db, admin, quizId, question));
    expect((await items(quizId)).length).toBe(2);
  });

  it("says so when the student has nothing to delete, and does not run twice", async () => {
    const quizId = await publishedQuiz();
    const gina = await addStudent("Gina");
    await attempt(gina.ctx, quizId);
    await as(() => deleteStudentResult(db, admin, quizId, gina.id));

    await failsWith(as(() => deleteStudentResult(db, admin, quizId, gina.id)), /no result/);
  });

  it("rejects ids that are not real", async () => {
    const quizId = await publishedQuiz();
    const hadi = await addStudent("Hadi");
    await attempt(hadi.ctx, quizId);

    await failsWith(as(() => deleteStudentResult(db, admin, "nope", hadi.id)), /not found/i);
    await failsWith(as(() => deleteStudentResult(db, admin, quizId, "nope")), /not found/i);
    await failsWith(
      as(() => deleteStudentResult(db, admin, quizId, "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b")),
      /no result/,
    );
    expect((await attemptsOf(hadi.id)).length).toBe(1);
  });

  it("cannot delete another school's results", async () => {
    const quizId = await publishedQuiz();
    const indra = await addStudent("Indra");
    await attempt(indra.ctx, quizId);
    const other = await seedSchool(db);
    const octx = { schoolId: other.school.id, userId: other.teacher.id };

    await failsWith(as(() => deleteStudentResult(db, octx, quizId, indra.id)), /not found/i);
    expect((await attemptsOf(indra.id)).length).toBe(1);
  });
});
