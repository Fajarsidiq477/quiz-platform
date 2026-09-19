import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Ctx } from "@/features/errors";
import { questionInputSchema, type QuizInput } from "@/features/quizzes/schemas";
import {
  addQuestion,
  closeQuiz,
  createQuiz,
  deleteQuiz,
  getQuiz,
  publishQuiz,
  type QuizItem,
} from "@/features/quizzes/service";
import {
  getAttemptPage,
  getMyQuiz,
  listMyQuizzes,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type AttemptResult,
  type AttemptTaking,
} from "@/features/student/service";
import {
  asAppRole,
  createAppRole,
  createTestDb,
  expectDbError,
  seedSchool,
  withoutTriggers,
  type TestDb,
  type World,
} from "../db/helpers";

const HOUR = 3_600_000;
const q = (input: Record<string, unknown>) => questionInputSchema.parse({ points: "2", ...input });

const QUESTIONS = [
  q({ type: "single_choice", prompt: "Which layer routes packets?", options: [{ text: "Data link", isCorrect: false }, { text: "Network", isCorrect: true }, { text: "Transport", isCorrect: false }] }),
  q({ type: "multiple_choice", prompt: "Which are private ranges?", points: "3", options: [{ text: "10.0.0.0/8", isCorrect: true }, { text: "8.8.8.0/24", isCorrect: false }, { text: "192.168.0.0/16", isCorrect: true }] }),
  q({ type: "true_false", prompt: "A switch works at layer 2.", points: "1", correct: true }),
  q({ type: "short_answer", prompt: "What does DNS stand for?", acceptedAnswers: ["domain name system"] }),
];
const MAX = 2 + 3 + 1 + 2; // points of QUESTIONS

describe("student quiz flow", () => {
  let db: TestDb;
  let w: World;
  let admin: Ctx;
  let student: Ctx;
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);
  const fail = (p: Promise<unknown>, code: string, message?: RegExp) =>
    expect(p).rejects.toMatchObject({ code, ...(message ? { message: expect.stringMatching(message) } : {}) });

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
    admin = { schoolId: w.school.id, userId: w.teacher.id };
    student = { schoolId: w.school.id, userId: w.student.id };
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
    resultsVisibility: "after_submit",
    ...over,
  });

  /** A published quiz with the four questions above (or fewer). */
  async function publishedQuiz(over: Partial<QuizInput> = {}, questions = QUESTIONS) {
    const { id } = await as(() => createQuiz(db, admin, quizInput(over)));
    for (const question of questions) await as(() => addQuestion(db, admin, id, question));
    await as(() => publishQuiz(db, admin, id));
    return id;
  }

  const key = async (quizId: string): Promise<QuizItem[]> => (await as(() => getQuiz(db, admin.schoolId, quizId)))!.items;
  const taking = async (attemptId: string, who = student) => (await as(() => getAttemptPage(db, who, attemptId))) as AttemptTaking;
  const result = async (attemptId: string, who = student) => (await as(() => getAttemptPage(db, who, attemptId))) as AttemptResult;
  const start = async (quizId: string, who = student) => (await as(() => startAttempt(db, who, quizId))).attemptId;

  const correctAnswers = (items: QuizItem[]) =>
    Object.fromEntries(
      items.map((i) => [
        i.id,
        i.type === "short_answer" ? { text: "Domain Name System" } : { optionIds: i.options.filter((o) => o.isCorrect).map((o) => o.id) },
      ]),
    );

  const attemptRow = async (id: string) => (await db.select().from(schema.attempts).where(eq(schema.attempts.id, id)))[0];
  const backdate = (attemptId: string, deadlineAgoMs: number) =>
    withoutTriggers(db, () =>
      db.execute(sql`update attempts set started_at = now() - interval '3 hours',
        deadline_at = now() - (${deadlineAgoMs} * interval '1 millisecond') where id = ${attemptId}`),
    );

  // ---------------------------------------------------------------------------------- listing
  describe("listing", () => {
    it("classifies quizzes into phases, only for classes the student is enrolled in", async () => {
      const w2 = await seedSchool(db);
      const a2: Ctx = { schoolId: w2.school.id, userId: w2.teacher.id };
      const s2: Ctx = { schoolId: w2.school.id, userId: w2.student.id };
      const mk = async (title: string, over: Partial<QuizInput> = {}) => {
        const { id } = await as(() => createQuiz(db, a2, { ...quizInput(over), title, classId: w2.cls.id }));
        await as(() => addQuestion(db, a2, id, QUESTIONS[2]));
        return id;
      };
      const open = await mk("Open");
      await as(() => publishQuiz(db, a2, open));
      const later = await mk("Later", { opensAt: new Date(Date.now() + 2 * HOUR), closesAt: new Date(Date.now() + 3 * HOUR) });
      await as(() => publishQuiz(db, a2, later));
      const closed = await mk("Closed");
      await as(() => publishQuiz(db, a2, closed));
      await as(() => closeQuiz(db, a2, closed));
      const done = await mk("Done");
      await as(() => publishQuiz(db, a2, done));
      await mk("Draft only"); // never published: must not appear

      // A class the student is not in.
      const otherClass = (await db.insert(schema.classes).values({ schoolId: w2.school.id, teacherId: w2.teacher.id, name: "Other", term: "1" }).returning())[0];
      const { id: hidden } = await as(() => createQuiz(db, a2, { ...quizInput(), title: "Hidden", classId: otherClass.id }));
      await as(() => addQuestion(db, a2, hidden, QUESTIONS[2]));
      await as(() => publishQuiz(db, a2, hidden));

      const { attemptId } = await as(() => startAttempt(db, s2, done));
      await as(() => submitAttempt(db, s2, attemptId));

      const list = await as(() => listMyQuizzes(db, s2));
      const phases = Object.fromEntries(list.map((x) => [x.title, x.phase]));
      expect(phases).toEqual({ Open: "available", Later: "upcoming", Closed: "missed", Done: "completed" });
      expect(list.find((x) => x.title === "Open")).toMatchObject({ className: "ICT 10A", questionCount: 1, timeLimitMinutes: 30, maxAttempts: 1, attemptsUsed: 0, openAttemptId: null });
    });

    it("shows an open attempt as in progress, and a finished one with its score", async () => {
      const quizId = await publishedQuiz({ title: "Listing" });
      const attemptId = await start(quizId);
      let card = (await as(() => listMyQuizzes(db, student))).find((x) => x.id === quizId)!;
      expect(card).toMatchObject({ phase: "in_progress", openAttemptId: attemptId, attemptsUsed: 1 });

      const keyed = await key(quizId);
      await as(() => submitAttempt(db, student, attemptId, correctAnswers(keyed)));
      card = (await as(() => listMyQuizzes(db, student))).find((x) => x.id === quizId)!;
      expect(card.phase).toBe("completed");
      expect(card.latestAttempt).toMatchObject({ id: attemptId, score: MAX, maxScore: MAX, resultsVisible: true });
    });

    it("hides a quiz that is archived or belongs to someone else's school", async () => {
      const quizId = await publishedQuiz({ title: "To archive" });
      const attemptId = await start(quizId);
      await as(() => submitAttempt(db, student, attemptId));
      await as(() => deleteQuiz(db, admin, quizId)); // has an attempt, so it is archived
      expect((await as(() => listMyQuizzes(db, student))).map((x) => x.id)).not.toContain(quizId);
      // ...but the student still reaches their own result.
      expect(await result(attemptId)).toMatchObject({ kind: "result" });

      const other = await seedSchool(db);
      expect(await as(() => listMyQuizzes(db, { schoolId: other.school.id, userId: other.student.id }))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------------- starting
  describe("starting an attempt", () => {
    it("creates an in-progress attempt whose start and deadline come from the database", async () => {
      const quizId = await publishedQuiz({ timeLimitMinutes: 30 });
      const { attemptId, created } = await as(() => startAttempt(db, student, quizId));
      expect(created).toBe(true);
      const row = await attemptRow(attemptId);
      expect(row).toMatchObject({ status: "in_progress", attemptNo: 1, studentId: student.userId });
      expect(row.deadlineAt.getTime() - row.startedAt.getTime()).toBe(30 * 60_000);
      expect(Math.abs(row.startedAt.getTime() - Date.now())).toBeLessThan(60_000);
      expect(row.maxScore).toBe("8.00");
    });

    it("an untimed quiz ends at its closing time", async () => {
      const closesAt = new Date(Date.now() + 5 * HOUR);
      const quizId = await publishedQuiz({ timeLimitMinutes: null, closesAt });
      const row = await attemptRow(await start(quizId));
      expect(row.deadlineAt.getTime()).toBe(closesAt.getTime());
    });

    it("is idempotent: starting twice (double click, two tabs) gives one attempt", async () => {
      const quizId = await publishedQuiz();
      const first = await as(() => startAttempt(db, student, quizId));
      const second = await as(() => startAttempt(db, student, quizId));
      const [c, d] = await Promise.all([as(() => startAttempt(db, student, quizId)), as(() => startAttempt(db, student, quizId))]);
      expect(second).toEqual({ attemptId: first.attemptId, created: false });
      expect(c.attemptId).toBe(first.attemptId);
      expect(d.attemptId).toBe(first.attemptId);
      const rows = await db.select().from(schema.attempts).where(and(eq(schema.attempts.quizId, quizId), eq(schema.attempts.studentId, student.userId)));
      expect(rows).toHaveLength(1);
    });

    it("enforces the number of attempts, numbering them 1, 2, ...", async () => {
      const quizId = await publishedQuiz({ maxAttempts: 2 });
      const one = await start(quizId);
      await as(() => submitAttempt(db, student, one));
      const two = await start(quizId);
      expect((await attemptRow(two)).attemptNo).toBe(2);
      await as(() => submitAttempt(db, student, two));
      await fail(as(() => startAttempt(db, student, quizId)), "invalid_state", /used all 2 attempts/);
    });

    it("refuses drafts, quizzes that have not opened, and closed quizzes", async () => {
      const draft = (await as(() => createQuiz(db, admin, quizInput()))).id;
      await fail(as(() => startAttempt(db, student, draft)), "not_found");

      const later = await publishedQuiz({ opensAt: new Date(Date.now() + 2 * HOUR), closesAt: new Date(Date.now() + 3 * HOUR) });
      await fail(as(() => startAttempt(db, student, later)), "invalid_state", /not opened yet/);

      const closed = await publishedQuiz();
      await as(() => closeQuiz(db, admin, closed));
      await fail(as(() => startAttempt(db, student, closed)), "invalid_state", /closed/);

      // Published, but its closing time has passed.
      const expired = await publishedQuiz();
      await db.update(schema.quizzes).set({ opensAt: new Date(Date.now() - 3 * HOUR), closesAt: new Date(Date.now() - HOUR) }).where(eq(schema.quizzes.id, expired));
      await fail(as(() => startAttempt(db, student, expired)), "invalid_state", /closed/);
    });

    it("refuses a student who is not enrolled in the quiz's class", async () => {
      const quizId = await publishedQuiz();
      const stranger = (await db.insert(schema.users).values({ schoolId: w.school.id, email: `x-${Math.random()}@example.test`, name: "Stranger", role: "student" }).returning())[0];
      await fail(as(() => startAttempt(db, { schoolId: w.school.id, userId: stranger.id }, quizId)), "not_found");

      await db.update(schema.enrollments).set({ status: "withdrawn" }).where(eq(schema.enrollments.studentId, student.userId));
      await fail(as(() => startAttempt(db, student, quizId)), "not_found");
      await db.update(schema.enrollments).set({ status: "active" }).where(eq(schema.enrollments.studentId, student.userId));
    });

    it("ends an abandoned attempt (time ran out) so a new one can be started", async () => {
      const quizId = await publishedQuiz({ maxAttempts: 2 });
      const old = await start(quizId);
      const items = await key(quizId);
      await as(() => saveAnswer(db, student, old, items[0].id, { optionIds: [items[0].options.find((o) => o.isCorrect)!.id] }));
      await backdate(old, 60_000); // deadline passed a minute ago

      const fresh = await start(quizId);
      expect(fresh).not.toBe(old);
      const ended = await attemptRow(old);
      expect(ended.status).toBe("graded");
      expect(ended.score).toBe("2.00"); // what was saved in time is graded
      expect((await attemptRow(fresh)).attemptNo).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------- taking
  describe("taking a quiz", () => {
    it("never sends the answer key to the browser", async () => {
      const quizId = await publishedQuiz();
      const dto = await taking(await start(quizId));
      expect(dto.kind).toBe("taking");
      const json = JSON.stringify(dto);
      expect(json).not.toContain("isCorrect");
      expect(json).not.toContain("acceptedAnswers");
      expect(json).not.toContain("domain name system");
      expect(json).not.toContain("explanation");
      // ...but everything needed to answer is there.
      expect(dto.items.map((i) => i.prompt)).toContain("Which layer routes packets?");
      expect(dto.items[0].options.map((o) => o.text)).toEqual(["Data link", "Network", "Transport"]);
      expect(dto.items.reduce((sum, i) => sum + i.points, 0)).toBe(MAX);
    });

    it("counts down by the database clock", async () => {
      const quizId = await publishedQuiz({ timeLimitMinutes: 30 });
      const attemptId = await start(quizId);
      const before = (await taking(attemptId)).remainingMs;
      expect(before).toBeGreaterThan(29 * 60_000);
      expect(before).toBeLessThanOrEqual(30 * 60_000);

      await backdate(attemptId, -10 * 60_000); // 10 minutes left
      const after = (await taking(attemptId)).remainingMs;
      expect(after).toBeGreaterThan(9 * 60_000);
      expect(after).toBeLessThanOrEqual(10 * 60_000);
    });

    it("shuffles the questions per attempt, the same way on every load", async () => {
      const many = Array.from({ length: 12 }, (_, i) => q({ type: "true_false", prompt: `Statement ${i + 1}`, correct: true }));
      const shuffled = await publishedQuiz({ shuffleQuestions: true, maxAttempts: 2 }, many);
      const one = await start(shuffled);
      const a = (await taking(one)).items.map((i) => i.prompt);
      const b = (await taking(one)).items.map((i) => i.prompt);
      expect(a).toEqual(b);
      expect(a).not.toEqual(many.map((m) => m.prompt));
      expect([...a].sort()).toEqual(many.map((m) => m.prompt).sort());

      const plain = await publishedQuiz({ shuffleQuestions: false }, many);
      expect((await taking(await start(plain))).items.map((i) => i.prompt)).toEqual(many.map((m) => m.prompt));
    });

    it("returns a saved answer when the page is reloaded", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await as(() => saveAnswer(db, student, attemptId, items[3].id, { text: "  dns  " }));
      expect((await taking(attemptId)).answers[items[3].id]).toEqual({ text: "dns" });
    });
  });

  // ---------------------------------------------------------------------------------- saving
  describe("saving answers", () => {
    let quizId: string;
    let attemptId: string;
    let items: QuizItem[];
    beforeAll(async () => {
      quizId = await publishedQuiz();
      attemptId = await start(quizId);
      items = await key(quizId);
    });
    const saved = () => db.select().from(schema.answers).where(eq(schema.answers.attemptId, attemptId));

    it("saves every question type, and a repeat converges on one row", async () => {
      const [single, multi, tf, short] = items;
      const opt = (i: QuizItem, n: number) => i.options[n].id;
      await as(() => saveAnswer(db, student, attemptId, single.id, { optionIds: [opt(single, 0)] }));
      await as(() => saveAnswer(db, student, attemptId, single.id, { optionIds: [opt(single, 0)] })); // replay
      await as(() => saveAnswer(db, student, attemptId, single.id, { optionIds: [opt(single, 1)] })); // changed mind
      await as(() => saveAnswer(db, student, attemptId, multi.id, { optionIds: [opt(multi, 0), opt(multi, 2)] }));
      await as(() => saveAnswer(db, student, attemptId, tf.id, { optionIds: [opt(tf, 0)] }));
      await as(() => saveAnswer(db, student, attemptId, short.id, { text: "DNS" }));

      const rows = await saved();
      expect(rows).toHaveLength(4);
      expect(rows.find((r) => r.quizQuestionId === single.id)?.response).toEqual({ optionIds: [opt(single, 1)] });
      // Grading fields stay empty until the attempt is finished.
      expect(rows.every((r) => r.isCorrect === null && r.pointsAwarded === null)).toBe(true);
    });

    it("lets an answer be cleared", async () => {
      await as(() => saveAnswer(db, student, attemptId, items[0].id, { optionIds: [] }));
      expect((await saved()).find((r) => r.quizQuestionId === items[0].id)?.response).toEqual({ optionIds: [] });
    });

    it("rejects answers that do not fit the question", async () => {
      const [single, multi, tf, short] = items;
      const other = items[1].options[0].id; // an option of a different question
      await fail(as(() => saveAnswer(db, student, attemptId, single.id, { optionIds: [other] })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, single.id, { optionIds: [single.options[0].id, single.options[1].id] })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, tf.id, { optionIds: [tf.options[0].id, tf.options[1].id] })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, multi.id, { optionIds: [multi.options[0].id, multi.options[0].id] })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, single.id, { optionIds: ["not-a-uuid"] })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, single.id, { text: "hi" })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, short.id, { optionIds: [] })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, short.id, { text: "x".repeat(2001) })), "invalid_input");
      await fail(as(() => saveAnswer(db, student, attemptId, short.id, { text: "ok", isCorrect: true })), "invalid_input"); // no extra keys
      await fail(as(() => saveAnswer(db, student, attemptId, "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b", { text: "x" })), "not_found");
    });

    it("reports the time left", async () => {
      const { remainingMs } = await as(() => saveAnswer(db, student, attemptId, items[3].id, { text: "dns" }));
      expect(remainingMs).toBeGreaterThan(29 * 60_000);
    });

    it("refuses saves once the deadline plus grace has passed", async () => {
      const id = await start(await publishedQuiz());
      const its = await key((await attemptRow(id)).quizId);
      await backdate(id, 6_000); // 6s past the deadline: beyond the 5s grace
      await fail(as(() => saveAnswer(db, student, id, its[3].id, { text: "late" })), "invalid_state", /Time is up/);
      const rows = await db.select().from(schema.answers).where(eq(schema.answers.attemptId, id));
      expect(rows).toEqual([]);
    });

    it("still accepts a save that arrives just after the deadline (within the grace)", async () => {
      const id = await start(await publishedQuiz());
      const its = await key((await attemptRow(id)).quizId);
      await backdate(id, 2_000);
      await expect(as(() => saveAnswer(db, student, id, its[3].id, { text: "just in time" }))).resolves.toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------------- submitting
  describe("submitting", () => {
    it("grades every type, stores the points per answer, and marks the attempt graded", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      const right = correctAnswers(items);
      // Two right, one wrong (multiple choice missing an option), one left blank.
      await as(() => saveAnswer(db, student, attemptId, items[0].id, right[items[0].id]));
      await as(() => saveAnswer(db, student, attemptId, items[1].id, { optionIds: [items[1].options[0].id] }));
      await as(() => saveAnswer(db, student, attemptId, items[2].id, right[items[2].id]));

      await as(() => submitAttempt(db, student, attemptId));
      const row = await attemptRow(attemptId);
      expect(row).toMatchObject({ status: "graded", score: "3.00", maxScore: "8.00" });
      expect(row.submittedAt).not.toBeNull();
      expect(row.gradedAt).not.toBeNull();

      const answers = await db.select().from(schema.answers).where(eq(schema.answers.attemptId, attemptId));
      const byItem = Object.fromEntries(answers.map((a) => [a.quizQuestionId, [a.isCorrect, a.pointsAwarded]]));
      expect(byItem[items[0].id]).toEqual([true, "2.00"]);
      expect(byItem[items[1].id]).toEqual([false, "0.00"]);
      expect(byItem[items[2].id]).toEqual([true, "1.00"]);
      expect(byItem[items[3].id]).toBeUndefined(); // blank: no row, worth 0
    });

    it("gives full marks for all-correct answers, and 0 for a blank submit", async () => {
      const quizId = await publishedQuiz({ maxAttempts: 2 });
      const items = await key(quizId);
      const full = await start(quizId);
      await as(() => submitAttempt(db, student, full, correctAnswers(items)));
      expect((await attemptRow(full)).score).toBe("8.00");

      const blank = await start(quizId);
      await as(() => submitAttempt(db, student, blank));
      expect((await attemptRow(blank)).score).toBe("0.00");
    });

    it("is idempotent: a second, third or concurrent submit changes nothing", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await as(() => saveAnswer(db, student, attemptId, items[0].id, correctAnswers(items)[items[0].id]));

      const [first] = await Promise.all([
        as(() => submitAttempt(db, student, attemptId)),
        as(() => submitAttempt(db, student, attemptId)),
      ]);
      const after1 = await attemptRow(attemptId);
      const answers1 = await db.select().from(schema.answers).where(eq(schema.answers.attemptId, attemptId));

      // A late replay carrying different answers must not alter a finished attempt.
      const replay = await as(() => submitAttempt(db, student, attemptId, correctAnswers(items)));
      const after2 = await attemptRow(attemptId);
      const answers2 = await db.select().from(schema.answers).where(eq(schema.answers.attemptId, attemptId));

      expect(replay).toEqual(first);
      expect(after2).toEqual(after1);
      expect(after1).toMatchObject({ status: "graded", score: "2.00" });
      expect(answers2).toEqual(answers1);
    });

    it("saves the final snapshot first, so a lost autosave cannot lose an answer", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      // Nothing was autosaved; the snapshot carries everything.
      await as(() => submitAttempt(db, student, attemptId, correctAnswers(items)));
      expect((await attemptRow(attemptId)).score).toBe("8.00");
    });

    it("rejects a snapshot that names an unknown question or an invalid answer, and changes nothing", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await fail(as(() => submitAttempt(db, student, attemptId, { "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b": { text: "x" } })), "not_found");
      await fail(as(() => submitAttempt(db, student, attemptId, { [items[0].id]: { optionIds: [items[1].options[0].id] } })), "invalid_input");
      expect((await attemptRow(attemptId)).status).toBe("in_progress"); // rolled back, still open
    });

    it("a submit within the grace after the deadline still counts as submitted", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await backdate(attemptId, 2_000);
      await as(() => submitAttempt(db, student, attemptId, correctAnswers(items)));
      const row = await attemptRow(attemptId);
      expect(row.score).toBe("8.00");
      expect(row.submittedAt!.getTime()).toBeGreaterThan(row.deadlineAt.getTime()); // handed in after the deadline
    });

    it("a submit beyond the grace expires the attempt: the late answers are ignored", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await as(() => saveAnswer(db, student, attemptId, items[0].id, correctAnswers(items)[items[0].id])); // in time
      await backdate(attemptId, 30_000);

      await as(() => submitAttempt(db, student, attemptId, correctAnswers(items))); // everything, but too late
      const row = await attemptRow(attemptId);
      expect(row.score).toBe("2.00"); // only the answer saved in time
      expect(row.submittedAt!.getTime()).toBe(row.deadlineAt.getTime()); // recorded as ended at the deadline
    });

    it("cannot save or change answers after submitting", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await as(() => submitAttempt(db, student, attemptId));
      await fail(as(() => saveAnswer(db, student, attemptId, items[0].id, { optionIds: [items[0].options[1].id] })), "invalid_state", /already been submitted/);
      // Straight to the database: the trigger refuses it as well.
      await expectDbError(
        db.insert(schema.answers).values({ schoolId: w.school.id, attemptId, quizId, quizQuestionId: items[0].id, response: { optionIds: [] } }),
        /not in progress/,
      );
    });
  });

  // ---------------------------------------------------------------------------------- results
  describe("results", () => {
    it("after_submit: shows the score and a full review with the correct answers", async () => {
      const quizId = await publishedQuiz({ resultsVisibility: "after_submit" });
      const attemptId = await start(quizId);
      const items = await key(quizId);
      await as(() => submitAttempt(db, student, attemptId, { ...correctAnswers(items), [items[0].id]: { optionIds: [items[0].options[0].id] } }));

      const r = await result(attemptId);
      expect(r).toMatchObject({ kind: "result", visible: true, hiddenReason: null, score: 6, maxScore: 8, status: "graded" });
      expect(r.items).toHaveLength(4);
      const first = r.items![0];
      expect(first).toMatchObject({ isCorrect: false, pointsAwarded: 0, answered: true });
      expect(first.options.map((o) => [o.text, o.selected, o.isCorrect])).toEqual([
        ["Data link", true, false],
        ["Network", false, true],
        ["Transport", false, false],
      ]);
      expect(r.items![3]).toMatchObject({ isCorrect: true, yourText: "Domain Name System", acceptedAnswers: ["domain name system"] });
    });

    it("after_close: hides everything until the quiz closes, then shows it", async () => {
      const quizId = await publishedQuiz({ resultsVisibility: "after_close" });
      const attemptId = await start(quizId);
      const keyed = await key(quizId);
      await as(() => submitAttempt(db, student, attemptId, correctAnswers(keyed)));

      const hidden = await result(attemptId);
      expect(hidden).toMatchObject({ visible: false, score: null, maxScore: null, items: null });
      expect(hidden.hiddenReason).toMatch(/after the quiz closes/);
      // Nothing about correctness leaks while hidden.
      expect(JSON.stringify(hidden)).not.toMatch(/isCorrect|acceptedAnswers|domain name system|Data link|Transport/);
      const listed = (await as(() => listMyQuizzes(db, student))).find((x) => x.id === quizId)!;
      expect(listed.latestAttempt).toMatchObject({ score: null, maxScore: null, resultsVisible: false });

      await as(() => closeQuiz(db, admin, quizId));
      expect(await result(attemptId)).toMatchObject({ visible: true, score: 8, maxScore: 8 });
      const detail = (await as(() => getMyQuiz(db, student, quizId)))!;
      expect(detail.attempts[0]).toMatchObject({ score: 8, resultsVisible: true });
    });

    it("never: the score stays hidden even after the quiz closes", async () => {
      const quizId = await publishedQuiz({ resultsVisibility: "never" });
      const attemptId = await start(quizId);
      const keyed = await key(quizId);
      await as(() => submitAttempt(db, student, attemptId, correctAnswers(keyed)));
      await as(() => closeQuiz(db, admin, quizId));
      const r = await result(attemptId);
      expect(r).toMatchObject({ visible: false, score: null, items: null });
      expect(r.hiddenReason).toMatch(/chosen not to show/);
    });

    it("lists a student's attempts on the quiz page, newest first", async () => {
      const quizId = await publishedQuiz({ maxAttempts: 3 });
      for (let i = 0; i < 2; i++) {
        const id = await start(quizId);
        await as(() => submitAttempt(db, student, id));
      }
      const detail = (await as(() => getMyQuiz(db, student, quizId)))!;
      expect(detail.attempts.map((a) => a.attemptNo)).toEqual([2, 1]);
      expect(detail.quiz).toMatchObject({ attemptsUsed: 2, phase: "available" });
    });
  });

  // ---------------------------------------------------------------------------------- ownership
  describe("ownership and tenants", () => {
    it("one student cannot see, save to or submit another student's attempt", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const items = await key(quizId);

      const peer = (await db.insert(schema.users).values({ schoolId: w.school.id, email: `peer-${Math.random()}@example.test`, name: "Peer", role: "student" }).returning())[0];
      await db.insert(schema.enrollments).values({ schoolId: w.school.id, classId: w.cls.id, studentId: peer.id });
      const p: Ctx = { schoolId: w.school.id, userId: peer.id };

      expect(await as(() => getAttemptPage(db, p, attemptId))).toBeNull();
      await fail(as(() => saveAnswer(db, p, attemptId, items[3].id, { text: "x" })), "not_found");
      await fail(as(() => submitAttempt(db, p, attemptId)), "not_found");
      expect((await attemptRow(attemptId)).status).toBe("in_progress");
    });

    it("a student of another school sees nothing of this school", async () => {
      const quizId = await publishedQuiz();
      const attemptId = await start(quizId);
      const other = await seedSchool(db);
      const o: Ctx = { schoolId: other.school.id, userId: other.student.id };
      expect(await as(() => getAttemptPage(db, o, attemptId))).toBeNull();
      expect(await as(() => getMyQuiz(db, o, quizId))).toBeNull();
      await fail(as(() => startAttempt(db, o, quizId)), "not_found");
      await fail(as(() => saveAnswer(db, o, attemptId, "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b", { text: "x" })), "not_found");
    });

    it("malformed ids are reported as not found, not as errors", async () => {
      expect(await as(() => getAttemptPage(db, student, "nope"))).toBeNull();
      expect(await as(() => getMyQuiz(db, student, "nope"))).toBeNull();
      await fail(as(() => startAttempt(db, student, "nope")), "not_found");
      await fail(as(() => submitAttempt(db, student, "nope")), "not_found");
    });
  });
});
