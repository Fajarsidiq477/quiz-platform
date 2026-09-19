import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Ctx } from "@/features/errors";
import { questionInputSchema, type QuestionInput, type QuizInput } from "@/features/quizzes/schemas";
import {
  addQuestion,
  closeQuiz,
  createQuiz,
  deleteQuiz,
  getQuiz,
  listQuizzes,
  moveQuestion,
  publishQuiz,
  removeQuestion,
  unpublishQuiz,
  updateQuestion,
  updateQuiz,
} from "@/features/quizzes/service";
import {
  asAppRole,
  createAppRole,
  createTestDb,
  seedSchool,
  startAttempt,
  type TestDb,
  type World,
} from "../db/helpers";

const HOUR = 3_600_000;

const quizInput = (w: World, over: Partial<QuizInput> = {}): QuizInput => ({
  title: "Networking basics",
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

/** Goes through the real schema so tests use exactly what the forms produce. */
const question = (input: Record<string, unknown>): QuestionInput =>
  questionInputSchema.parse({ prompt: "Which layer routes packets?", points: "2", ...input });

const single = (prompt = "Which layer routes packets?") =>
  question({
    type: "single_choice",
    prompt,
    options: [
      { text: "Data link", isCorrect: false },
      { text: "Network", isCorrect: true },
      { text: "Transport", isCorrect: false },
    ],
  });
const multiple = () =>
  question({
    type: "multiple_choice",
    prompt: "Which are private IPv4 ranges?",
    options: [
      { text: "10.0.0.0/8", isCorrect: true },
      { text: "8.8.8.0/24", isCorrect: false },
      { text: "192.168.0.0/16", isCorrect: true },
    ],
  });
const trueFalse = () => question({ type: "true_false", prompt: "A switch works at layer 2.", correct: true });
const shortAnswer = () =>
  question({ type: "short_answer", prompt: "What does DNS stand for?", acceptedAnswers: ["domain name system"] });

describe("quizzes service", () => {
  let db: TestDb;
  let w: World;
  let ctx: Ctx;
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
    ctx = { schoolId: w.school.id, userId: w.teacher.id };
  });

  const newQuiz = async (over: Partial<QuizInput> = {}) => (await as(() => createQuiz(db, ctx, quizInput(w, over)))).id;
  const detail = async (id: string) => (await as(() => getQuiz(db, ctx.schoolId, id)))!;
  const expectFail = (p: Promise<unknown>, code: string, message?: RegExp) =>
    expect(p).rejects.toMatchObject({ code, ...(message ? { message: expect.stringMatching(message) } : {}) });

  describe("creating and editing settings", () => {
    it("creates a draft, converting minutes to seconds", async () => {
      const id = await newQuiz({ description: "Chapter 3", timeLimitMinutes: 45, shuffleQuestions: true });
      const d = await detail(id);
      expect(d.quiz).toMatchObject({
        status: "draft",
        title: "Networking basics",
        description: "Chapter 3",
        timeLimitSeconds: 2700,
        shuffleQuestions: true,
        createdBy: ctx.userId,
        schoolId: ctx.schoolId,
      });
      expect(d.className).toBe("ICT 10A");
      expect(d.items).toEqual([]);
      expect(d.attemptCount).toBe(0);
    });

    it("allows an untimed quiz and a draft without a window", async () => {
      const id = await newQuiz({ timeLimitMinutes: null, opensAt: null, closesAt: null });
      expect((await detail(id)).quiz).toMatchObject({ timeLimitSeconds: null, opensAt: null, closesAt: null });
    });

    it("updates the settings of a draft", async () => {
      const id = await newQuiz();
      await as(() => updateQuiz(db, ctx, id, quizInput(w, { title: "Renamed", maxAttempts: 3 })));
      expect((await detail(id)).quiz).toMatchObject({ title: "Renamed", maxAttempts: 3 });
    });

    it("refuses a class from another school or an archived class", async () => {
      const other = await seedSchool(db);
      await expectFail(as(() => createQuiz(db, ctx, quizInput(w, { classId: other.cls.id }))), "invalid_input", /class/i);

      const id = await newQuiz();
      await expectFail(as(() => updateQuiz(db, ctx, id, quizInput(w, { classId: other.cls.id }))), "invalid_input");

      const [archived] = await db
        .insert(schema.classes)
        .values({ schoolId: w.school.id, teacherId: w.teacher.id, name: "Old", term: "2020", archivedAt: new Date() })
        .returning();
      await expectFail(as(() => createQuiz(db, ctx, quizInput(w, { classId: archived.id }))), "invalid_input");
    });

    it("lists quizzes newest first with their question counts", async () => {
      const w2 = await seedSchool(db);
      const c2 = { schoolId: w2.school.id, userId: w2.teacher.id };
      const first = (await as(() => createQuiz(db, c2, quizInput(w2, { title: "First" })))).id;
      await as(() => createQuiz(db, c2, quizInput(w2, { title: "Second" })));
      await as(() => addQuestion(db, c2, first, single()));
      await as(() => addQuestion(db, c2, first, trueFalse()));

      const list = await as(() => listQuizzes(db, w2.school.id));
      expect(list.map((q) => q.title)).toEqual(["Second", "First"]);
      expect(list.find((q) => q.title === "First")).toMatchObject({ questionCount: 2, className: "ICT 10A" });
      expect(list.find((q) => q.title === "Second")?.questionCount).toBe(0);
    });
  });

  describe("questions", () => {
    it("adds each question type as version 1, published, at the end", async () => {
      const id = await newQuiz({ title: "Mixed" });
      for (const q of [single(), multiple(), trueFalse(), shortAnswer()]) {
        await as(() => addQuestion(db, ctx, id, q));
      }
      const { items } = await detail(id);

      expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
      expect(items.map((i) => i.type)).toEqual(["single_choice", "multiple_choice", "true_false", "short_answer"]);
      expect(items.every((i) => i.versionNo === 1 && i.points === "2.00")).toBe(true);

      expect(items[0].options.map((o) => [o.text, o.isCorrect])).toEqual([
        ["Data link", false],
        ["Network", true],
        ["Transport", false],
      ]);
      expect(items[1].options.filter((o) => o.isCorrect)).toHaveLength(2);
      expect(items[2].options.map((o) => [o.text, o.isCorrect])).toEqual([
        ["True", true],
        ["False", false],
      ]);
      expect(items[3]).toMatchObject({ acceptedAnswers: ["domain name system"], options: [] });

      // Every stored version is published, and the question topic comes from the quiz.
      const versions = await db.select().from(schema.questionVersions).where(eq(schema.questionVersions.schoolId, ctx.schoolId));
      expect(versions.filter((v) => items.some((i) => i.versionId === v.id)).every((v) => v.publishedAt)).toBe(true);
      const [q] = await db.select().from(schema.questions).where(eq(schema.questions.id, items[0].questionId));
      expect(q).toMatchObject({ topic: "Mixed", createdBy: ctx.userId });
    });

    it("editing content creates version 2 and leaves version 1 untouched", async () => {
      const id = await newQuiz();
      const { id: itemId } = await as(() => addQuestion(db, ctx, id, single("Original prompt")));
      const before = (await detail(id)).items[0];

      await as(() => updateQuestion(db, ctx, id, itemId, single("Reworded prompt")));
      const after = (await detail(id)).items[0];

      expect(after).toMatchObject({ id: itemId, questionId: before.questionId, versionNo: 2, prompt: "Reworded prompt" });
      expect(after.versionId).not.toBe(before.versionId);

      // Version 1 is still there, unchanged, published, and its options are intact.
      const [v1] = await db.select().from(schema.questionVersions).where(eq(schema.questionVersions.id, before.versionId));
      expect(v1).toMatchObject({ versionNo: 1, prompt: "Original prompt" });
      expect(v1.publishedAt).not.toBeNull();
      const v1Options = await db.select().from(schema.questionOptions).where(eq(schema.questionOptions.questionVersionId, before.versionId));
      expect(v1Options).toHaveLength(3);
      const all = await db.select().from(schema.questionVersions).where(eq(schema.questionVersions.questionId, before.questionId));
      expect(all.map((v) => v.versionNo).sort()).toEqual([1, 2]);
    });

    it("changing only the points does not create a new version", async () => {
      const id = await newQuiz();
      const { id: itemId } = await as(() => addQuestion(db, ctx, id, single()));
      const before = (await detail(id)).items[0];

      await as(() => updateQuestion(db, ctx, id, itemId, { ...single(), points: 5 }));
      const after = (await detail(id)).items[0];
      expect(after).toMatchObject({ versionId: before.versionId, versionNo: 1, points: "5.00" });
    });

    it("can change a question's type and its correct answer", async () => {
      const id = await newQuiz();
      const { id: itemId } = await as(() => addQuestion(db, ctx, id, single()));
      await as(() => updateQuestion(db, ctx, id, itemId, shortAnswer()));
      const item = (await detail(id)).items[0];
      expect(item).toMatchObject({ type: "short_answer", versionNo: 2, options: [] });

      await as(() => updateQuestion(db, ctx, id, itemId, question({ type: "true_false", prompt: "x", correct: false })));
      expect((await detail(id)).items[0].options.map((o) => o.isCorrect)).toEqual([false, true]);
    });

    it("removes a question from the quiz but keeps it in the question bank", async () => {
      const id = await newQuiz();
      const { id: itemId } = await as(() => addQuestion(db, ctx, id, single()));
      const item = (await detail(id)).items[0];

      await as(() => removeQuestion(db, ctx, id, itemId));
      expect((await detail(id)).items).toEqual([]);
      const kept = await db.select().from(schema.questionVersions).where(eq(schema.questionVersions.id, item.versionId));
      expect(kept).toHaveLength(1);
      await expectFail(as(() => removeQuestion(db, ctx, id, itemId)), "not_found");
    });

    it("moves a question up and down, and ignores moves past the ends", async () => {
      const id = await newQuiz();
      const ids: string[] = [];
      for (const prompt of ["A", "B", "C"]) ids.push((await as(() => addQuestion(db, ctx, id, single(prompt)))).id);
      const order = async () => (await detail(id)).items.map((i) => i.prompt);

      await as(() => moveQuestion(db, ctx, id, ids[2], "up"));
      expect(await order()).toEqual(["A", "C", "B"]);
      await as(() => moveQuestion(db, ctx, id, ids[0], "down"));
      expect(await order()).toEqual(["C", "A", "B"]);

      // Order is now C, A, B: B (ids[1]) is last and C (ids[2]) is first, so these do nothing.
      await as(() => moveQuestion(db, ctx, id, ids[1], "down"));
      await as(() => moveQuestion(db, ctx, id, ids[2], "up"));
      expect(await order()).toEqual(["C", "A", "B"]);
      expect((await detail(id)).items.map((i) => i.position)).toHaveLength(3);
    });

    it("keeps working after a removal leaves a gap in the positions", async () => {
      const id = await newQuiz();
      const ids: string[] = [];
      for (const prompt of ["A", "B", "C"]) ids.push((await as(() => addQuestion(db, ctx, id, single(prompt)))).id);
      await as(() => removeQuestion(db, ctx, id, ids[1]));
      await as(() => moveQuestion(db, ctx, id, ids[2], "up"));
      expect((await detail(id)).items.map((i) => i.prompt)).toEqual(["C", "A"]);
      const added = await as(() => addQuestion(db, ctx, id, single("D")));
      expect((await detail(id)).items.at(-1)?.id).toBe(added.id);
    });

    it("refuses a question in someone else's quiz or with an unknown id", async () => {
      const id = await newQuiz();
      const { id: itemId } = await as(() => addQuestion(db, ctx, id, single()));
      const other = await newQuiz({ title: "Other" });
      await expectFail(as(() => updateQuestion(db, ctx, other, itemId, single())), "not_found");
      await expectFail(as(() => removeQuestion(db, ctx, other, itemId)), "not_found");
      await expectFail(as(() => moveQuestion(db, ctx, other, itemId, "up")), "not_found");
      await expectFail(as(() => removeQuestion(db, ctx, id, "not-a-uuid")), "not_found");
    });
  });

  describe("lifecycle", () => {
    const ready = async (over: Partial<QuizInput> = {}) => {
      const id = await newQuiz(over);
      await as(() => addQuestion(db, ctx, id, single()));
      return id;
    };

    it("publishes a complete draft", async () => {
      const id = await ready();
      await as(() => publishQuiz(db, ctx, id));
      expect((await detail(id)).quiz.status).toBe("published");
    });

    it("refuses to publish without a window, with a past closing time, or without questions", async () => {
      const noWindow = await ready({ opensAt: null, closesAt: null });
      await expectFail(as(() => publishQuiz(db, ctx, noWindow)), "invalid_input", /opening and closing time/);

      const past = await ready({ opensAt: new Date(Date.now() - 3 * HOUR), closesAt: new Date(Date.now() - HOUR) });
      await expectFail(as(() => publishQuiz(db, ctx, past)), "invalid_input", /already passed/);

      const empty = await newQuiz();
      await expectFail(as(() => publishQuiz(db, ctx, empty)), "invalid_input", /at least one question/);
      expect((await detail(empty)).quiz.status).toBe("draft");
    });

    it("locks a published quiz against edits until it is unpublished", async () => {
      const id = await ready();
      await as(() => publishQuiz(db, ctx, id));
      const item = (await detail(id)).items[0];

      await expectFail(as(() => updateQuiz(db, ctx, id, quizInput(w))), "invalid_state", /draft/);
      await expectFail(as(() => addQuestion(db, ctx, id, trueFalse())), "invalid_state");
      await expectFail(as(() => updateQuestion(db, ctx, id, item.id, single("x"))), "invalid_state");
      await expectFail(as(() => removeQuestion(db, ctx, id, item.id)), "invalid_state");
      await expectFail(as(() => moveQuestion(db, ctx, id, item.id, "down")), "invalid_state");
      await expectFail(as(() => publishQuiz(db, ctx, id)), "invalid_state");

      await as(() => unpublishQuiz(db, ctx, id));
      await as(() => addQuestion(db, ctx, id, trueFalse()));
      expect((await detail(id)).items).toHaveLength(2);
    });

    it("cannot be unpublished once a student has started it", async () => {
      const id = await ready();
      await as(() => publishQuiz(db, ctx, id));
      await startAttempt(db, w, id);
      expect((await detail(id)).attemptCount).toBe(1);
      await expectFail(as(() => unpublishQuiz(db, ctx, id)), "invalid_state", /already started/);
      expect((await detail(id)).quiz.status).toBe("published");
    });

    it("closes only a published quiz", async () => {
      const id = await ready();
      await expectFail(as(() => closeQuiz(db, ctx, id)), "invalid_state");
      await as(() => publishQuiz(db, ctx, id));
      await as(() => closeQuiz(db, ctx, id));
      expect((await detail(id)).quiz.status).toBe("closed");
      await expectFail(as(() => unpublishQuiz(db, ctx, id)), "invalid_state");
    });
  });

  describe("deleting", () => {
    it("deletes a quiz nobody attempted, keeping its questions in the bank", async () => {
      const id = await newQuiz();
      await as(() => addQuestion(db, ctx, id, single()));
      const versionId = (await detail(id)).items[0].versionId;

      expect(await as(() => deleteQuiz(db, ctx, id))).toBe("deleted");
      expect(await as(() => getQuiz(db, ctx.schoolId, id))).toBeNull();
      expect(await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, id))).toEqual([]);
      expect(await db.select().from(schema.quizQuestions).where(eq(schema.quizQuestions.quizId, id))).toEqual([]);
      expect(await db.select().from(schema.questionVersions).where(eq(schema.questionVersions.id, versionId))).toHaveLength(1);
    });

    it("archives a quiz that has attempts, keeping the attempts and answers", async () => {
      const id = await newQuiz();
      await as(() => addQuestion(db, ctx, id, single()));
      await as(() => publishQuiz(db, ctx, id));
      const attempt = await startAttempt(db, w, id);

      expect(await as(() => deleteQuiz(db, ctx, id))).toBe("archived");
      expect(await as(() => getQuiz(db, ctx.schoolId, id))).toBeNull();
      expect((await as(() => listQuizzes(db, ctx.schoolId))).map((q) => q.id)).not.toContain(id);

      const [row] = await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, id));
      expect(row).toMatchObject({ status: "closed" });
      expect(row.archivedAt).not.toBeNull();
      const kept = await db.select().from(schema.attempts).where(and(eq(schema.attempts.id, attempt.id)));
      expect(kept).toHaveLength(1);
    });

    it("reports an unknown quiz as not found", async () => {
      await expectFail(as(() => deleteQuiz(db, ctx, "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b")), "not_found");
      await expectFail(as(() => deleteQuiz(db, ctx, "nope")), "not_found");
    });
  });

  describe("tenant isolation", () => {
    it("never lets another school read or change a quiz", async () => {
      const id = await newQuiz({ title: "Private" });
      await as(() => addQuestion(db, ctx, id, single()));
      const item = (await detail(id)).items[0];

      const other = await seedSchool(db);
      const octx = { schoolId: other.school.id, userId: other.teacher.id };

      expect(await as(() => getQuiz(db, other.school.id, id))).toBeNull();
      expect((await as(() => listQuizzes(db, other.school.id))).map((q) => q.id)).not.toContain(id);
      await expectFail(as(() => updateQuiz(db, octx, id, quizInput(other))), "not_found");
      await expectFail(as(() => publishQuiz(db, octx, id)), "not_found");
      await expectFail(as(() => deleteQuiz(db, octx, id)), "not_found");
      await expectFail(as(() => addQuestion(db, octx, id, single())), "not_found");
      await expectFail(as(() => removeQuestion(db, octx, id, item.id)), "not_found");

      expect((await detail(id)).quiz.title).toBe("Private");
      expect((await detail(id)).items).toHaveLength(1);
    });
  });
});
