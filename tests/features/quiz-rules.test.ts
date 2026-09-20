import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ServiceError, type Ctx } from "@/features/errors";
import {
  questionInputSchema,
  quizRulesSchema,
  type QuizInput,
  type QuizRulesInput,
} from "@/features/quizzes/schemas";
import {
  addQuestion,
  closeQuiz,
  createQuiz,
  getQuiz,
  publishQuiz,
  reopenQuiz,
  updateQuiz,
  updateQuizRules,
} from "@/features/quizzes/service";
import { startAttempt, submitAttempt } from "@/features/student/service";
import { asAppRole, createAppRole, createTestDb, seedSchool, type TestDb, type World } from "../db/helpers";

const HOUR = 3_600_000;

const validRules = {
  title: "  Networking  ",
  description: "",
  opensAt: "2026-10-01T01:00:00.000Z",
  closesAt: "2026-10-01T03:00:00.000Z",
  maxAttempts: "2",
  shuffleQuestions: true,
  resultsVisibility: "after_submit",
};

describe("quizRulesSchema", () => {
  it("parses the rules form into typed values", () => {
    const rules = quizRulesSchema.parse(validRules);
    expect(rules).toMatchObject({
      title: "Networking",
      description: null,
      maxAttempts: 2,
      shuffleQuestions: true,
      resultsVisibility: "after_submit",
    });
    expect(rules.opensAt).toEqual(new Date("2026-10-01T01:00:00.000Z"));
    expect(rules.closesAt).toEqual(new Date("2026-10-01T03:00:00.000Z"));
  });

  it("has no class or time limit to change: they are frozen once students attempt", () => {
    const rules = quizRulesSchema.parse({ ...validRules, classId: "x", timeLimitMinutes: "5" });
    expect(rules).not.toHaveProperty("classId");
    expect(rules).not.toHaveProperty("timeLimitMinutes");
  });

  it("needs both times, unlike a draft", () => {
    for (const field of ["opensAt", "closesAt"] as const) {
      const result = quizRulesSchema.safeParse({ ...validRules, [field]: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]).toMatchObject({ path: [field], message: "Choose a date and time" });
    }
    expect(quizRulesSchema.safeParse({ ...validRules, closesAt: "tomorrow" }).success).toBe(false);
  });

  it("puts the closing time after the opening time", () => {
    const result = quizRulesSchema.safeParse({ ...validRules, closesAt: validRules.opensAt });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["closesAt"]);
  });

  it("keeps the attempts limits", () => {
    expect(quizRulesSchema.safeParse({ ...validRules, maxAttempts: "0" }).success).toBe(false);
    expect(quizRulesSchema.safeParse({ ...validRules, maxAttempts: "21" }).success).toBe(false);
  });
});

describe("reopening a quiz and changing its rules", () => {
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
    maxAttempts: 1,
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
  const rules = (over: Partial<QuizRulesInput> = {}): QuizRulesInput => ({
    title: "Networking, second round",
    description: "Retake",
    opensAt: new Date(Date.now() - HOUR),
    closesAt: new Date(Date.now() + 48 * HOUR),
    maxAttempts: 2,
    shuffleQuestions: true,
    resultsVisibility: "after_submit",
    ...over,
  });

  async function publishedQuiz(over: Partial<QuizInput> = {}) {
    const { id } = await as(() => createQuiz(db, admin, quizInput(over)));
    await as(() => addQuestion(db, admin, id, question));
    await as(() => publishQuiz(db, admin, id));
    return id;
  }
  const detail = async (id: string) => (await as(() => getQuiz(db, admin.schoolId, id)))!;

  /** The seeded student starts the quiz and hands it in. */
  async function studentFinishes(quizId: string) {
    const who = { schoolId: w.school.id, userId: w.student.id };
    const { attemptId } = await as(() => startAttempt(db, who, quizId));
    await as(() => submitAttempt(db, who, attemptId, {}));
    return { who, attemptId };
  }

  async function rejects(promise: Promise<unknown>, message: RegExp, code?: string) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).message).toMatch(message);
    if (code) expect((error as ServiceError).code).toBe(code);
  }

  describe("a closed quiz nobody attempted", () => {
    it("reopens as a draft that can be edited again", async () => {
      const id = await publishedQuiz();
      await as(() => closeQuiz(db, admin, id));

      expect(await as(() => reopenQuiz(db, admin, id, null))).toBe("draft");
      expect((await detail(id)).quiz.status).toBe("draft");

      // Everything is editable again, including the frozen-once-attempted fields.
      await as(() => updateQuiz(db, admin, id, quizInput({ timeLimitMinutes: 45, title: "Edited" })));
      const after = await detail(id);
      expect(after.quiz.timeLimitSeconds).toBe(45 * 60);
      expect(after.quiz.title).toBe("Edited");
    });

    it("ignores rules it does not need", async () => {
      const id = await publishedQuiz();
      await as(() => closeQuiz(db, admin, id));
      expect(await as(() => reopenQuiz(db, admin, id, rules()))).toBe("draft");
    });
  });

  describe("a closed quiz students attempted", () => {
    it("is published again with the new rules and keeps every result", async () => {
      const id = await publishedQuiz();
      const { who, attemptId } = await studentFinishes(id);
      await as(() => closeQuiz(db, admin, id));
      const before = await detail(id);
      expect(before.attemptCount).toBe(1);

      const next = rules();
      expect(await as(() => reopenQuiz(db, admin, id, next))).toBe("published");

      const after = await detail(id);
      expect(after.quiz).toMatchObject({
        status: "published",
        title: "Networking, second round",
        description: "Retake",
        maxAttempts: 2,
        shuffleQuestions: true,
        resultsVisibility: "after_submit",
      });
      expect(after.quiz.closesAt).toEqual(next.closesAt);
      // The result is still there, and the frozen fields did not move.
      expect(after.attemptCount).toBe(1);
      const kept = await db.select().from(schema.attempts);
      expect(kept.map((a) => a.id)).toContain(attemptId);
      expect(after.quiz.timeLimitSeconds).toBe(before.quiz.timeLimitSeconds);
      expect(after.quiz.classId).toBe(before.quiz.classId);
      expect(after.items.map((i) => i.versionId)).toEqual(before.items.map((i) => i.versionId));

      // The student had used their only attempt; the raised limit lets them start attempt 2.
      const second = await as(() => startAttempt(db, who, id));
      const [row] = await db.select().from(schema.attempts).where(eq(schema.attempts.id, second.attemptId));
      expect(row.attemptNo).toBe(2);
    });

    it("keeps a student who used every attempt out unless the limit is raised", async () => {
      const id = await publishedQuiz();
      const { who } = await studentFinishes(id);
      await as(() => closeQuiz(db, admin, id));
      await as(() => reopenQuiz(db, admin, id, rules({ maxAttempts: 1 })));
      await expect(as(() => startAttempt(db, who, id))).rejects.toThrow();
    });

    it("needs rules, and a closing time that is still in the future", async () => {
      const id = await publishedQuiz();
      await studentFinishes(id);
      await as(() => closeQuiz(db, admin, id));

      await rejects(as(() => reopenQuiz(db, admin, id, null)), /new opening and closing time/);
      await rejects(
        as(() => reopenQuiz(db, admin, id, rules({ closesAt: new Date(Date.now() - 1000) }))),
        /already passed/,
      );
      expect((await detail(id)).quiz.status).toBe("closed");
    });
  });

  it("only reopens a closed quiz", async () => {
    const published = await publishedQuiz();
    await rejects(as(() => reopenQuiz(db, admin, published, rules())), /Only a closed quiz/, "invalid_state");

    const { id: draft } = await as(() => createQuiz(db, admin, quizInput()));
    await rejects(as(() => reopenQuiz(db, admin, draft, null)), /Only a closed quiz/, "invalid_state");
  });

  describe("changing the rules of a quiz that is already running", () => {
    it("changes the rules and nothing frozen", async () => {
      const id = await publishedQuiz();
      await studentFinishes(id);
      const before = await detail(id);

      const next = rules({ maxAttempts: 3, resultsVisibility: "never" });
      await as(() => updateQuizRules(db, admin, id, next));

      const after = await detail(id);
      expect(after.quiz).toMatchObject({
        status: "published",
        maxAttempts: 3,
        resultsVisibility: "never",
        title: "Networking, second round",
      });
      expect(after.quiz.closesAt).toEqual(next.closesAt);
      expect(after.quiz.timeLimitSeconds).toBe(before.quiz.timeLimitSeconds);
      expect(after.quiz.classId).toBe(before.quiz.classId);
      expect(after.attemptCount).toBe(1);
    });

    it("works on a closed quiz without reopening it", async () => {
      const id = await publishedQuiz();
      await studentFinishes(id);
      await as(() => closeQuiz(db, admin, id));
      await as(() => updateQuizRules(db, admin, id, rules({ title: "Renamed" })));
      expect(await detail(id)).toMatchObject({ quiz: { status: "closed", title: "Renamed" } });
    });

    it("leaves a draft to its own settings form", async () => {
      const { id } = await as(() => createQuiz(db, admin, quizInput()));
      await rejects(as(() => updateQuizRules(db, admin, id, rules())), /draft/, "invalid_state");
    });
  });

  it("never touches a quiz of another school", async () => {
    const other = await seedSchool(db);
    const octx = { schoolId: other.school.id, userId: other.teacher.id };
    const id = await publishedQuiz();
    await studentFinishes(id);
    await as(() => closeQuiz(db, admin, id));

    await rejects(as(() => reopenQuiz(db, octx, id, rules())), /Quiz not found/, "not_found");
    await rejects(as(() => updateQuizRules(db, octx, id, rules())), /Quiz not found/, "not_found");
    expect((await detail(id)).quiz.status).toBe("closed");
  });
});
