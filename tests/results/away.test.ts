import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Ctx } from "@/features/errors";
import { AWAY_REASON_LABELS, formatAway, summariseAway, type AwayPeriod } from "@/features/attempts/away";
import { questionInputSchema, type QuizInput } from "@/features/quizzes/schemas";
import { addQuestion, createQuiz, getQuiz, publishQuiz } from "@/features/quizzes/service";
import { buildResultsCsv } from "@/features/results/csv";
import { getAttemptReview, getQuizResults } from "@/features/results/service";
import { reportAway } from "@/features/student/away";
import { startAttempt, submitAttempt } from "@/features/student/service";
import { asAppRole, createAppRole, createTestDb, seedSchool, withoutTriggers, type TestDb, type World } from "../db/helpers";

const at = (s: number) => new Date(Date.UTC(2026, 8, 20, 8, 0, s));
const period = (reason: AwayPeriod["reason"], from: number, to: number | null): AwayPeriod => ({
  reason,
  startedAt: at(from),
  endedAt: to === null ? null : at(to),
});

describe("summariseAway", () => {
  it("has nothing to report when the student never left", () => {
    expect(summariseAway([], at(100))).toEqual({ count: 0, totalMs: 0, longestMs: 0, entries: [] });
  });

  it("counts every period, their total, and the longest, oldest first", () => {
    const stats = summariseAway([period("blur", 50, 80), period("hidden", 10, 15), period("fullscreen", 90, 92)], at(200));
    expect(stats.entries.map((e) => e.reason)).toEqual(["hidden", "blur", "fullscreen"]);
    expect(stats).toMatchObject({ count: 3, totalMs: 37_000, longestMs: 30_000 });
    expect(stats.entries.every((e) => !e.neverReturned)).toBe(true);
  });

  it("counts a period that never ended up to the end of the attempt", () => {
    const stats = summariseAway([period("hidden", 60, null)], at(100));
    expect(stats.entries[0]).toMatchObject({ ms: 40_000, neverReturned: true });
    expect(stats.entries[0].endedAt).toEqual(at(100));
  });

  it("cuts a period off where the attempt ended", () => {
    // Handed in at 100; the tab was still hidden until 500. Only the time before 100 counts.
    const stats = summariseAway([period("hidden", 70, 500)], at(100));
    expect(stats.entries[0]).toMatchObject({ ms: 30_000, neverReturned: true });
  });

  it("ignores a period that began after the attempt was over", () => {
    expect(summariseAway([period("hidden", 100, 130), period("blur", 120, null)], at(100)).count).toBe(0);
  });
});

describe("formatAway", () => {
  it("reads naturally", () => {
    expect(formatAway(0)).toBe("0 s");
    expect(formatAway(45_400)).toBe("45 s");
    expect(formatAway(59_600)).toBe("1 min 00 s");
    expect(formatAway(125_000)).toBe("2 min 05 s");
    expect(formatAway(3_780_000)).toBe("1 h 03 min");
    expect(formatAway(-5)).toBe("0 s");
  });

  it("has words for every reason", () => {
    for (const reason of schema.AWAY_REASONS) expect(AWAY_REASON_LABELS[reason].length).toBeGreaterThan(3);
  });
});

describe("time away in the teacher's results", () => {
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

  const quizInput = (): QuizInput => ({
    title: "Networking",
    description: null,
    classId: w.cls.id,
    timeLimitMinutes: 30,
    opensAt: new Date(Date.now() - 3_600_000),
    closesAt: new Date(Date.now() + 24 * 3_600_000),
    maxAttempts: 2,
    shuffleQuestions: false,
    resultsVisibility: "after_close",
  });

  async function publishedQuiz() {
    const { id } = await as(() => createQuiz(db, admin, quizInput()));
    await as(() =>
      addQuestion(
        db,
        admin,
        id,
        questionInputSchema.parse({ type: "true_false", prompt: "A switch works at layer 2.", points: "1", correct: true }),
      ),
    );
    await as(() => publishQuiz(db, admin, id));
    return id;
  }
  async function addStudent(name: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ schoolId: w.school.id, email: `${name}-${Math.random().toString(36).slice(2, 7)}@example.test`, name, role: "student" })
      .returning();
    await db.insert(schema.enrollments).values({ schoolId: w.school.id, classId: w.cls.id, studentId: user.id });
    return { id: user.id, ctx: { schoolId: w.school.id, userId: user.id } as Ctx };
  }
  async function finishedAttempt(who: Ctx, quizId: string) {
    const { attemptId } = await as(() => startAttempt(db, who, quizId));
    await as(() => submitAttempt(db, who, attemptId, {}));
    const [row] = await db.select().from(schema.attempts).where(eq(schema.attempts.id, attemptId));
    return row;
  }
  /** Writes periods with exact times (the trigger would stamp "now"), relative to a moment. */
  const putPeriods = (
    attemptId: string,
    list: { reason: schema.AwayReason; from: number; to: number | null }[],
    base: Date,
  ) =>
    withoutTriggers(db, () =>
      db.insert(schema.attemptAwayPeriods).values(
        list.map((p) => ({
          schoolId: w.school.id,
          attemptId,
          reason: p.reason,
          startedAt: new Date(base.getTime() + p.from * 1000),
          endedAt: p.to === null ? null : new Date(base.getTime() + p.to * 1000),
        })),
      ),
    );

  it("shows how often, and for how long, in the results table and the CSV", async () => {
    const quizId = await publishedQuiz();
    const sari = await addStudent("Sari");
    const tono = await addStudent("Tono");
    const uci = await addStudent("Uci"); // never starts
    void uci;

    const sariAttempt = await finishedAttempt(sari.ctx, quizId);
    await finishedAttempt(tono.ctx, quizId);
    const handedIn = sariAttempt.submittedAt!;
    await putPeriods(
      sariAttempt.id,
      [
        { reason: "hidden", from: -60, to: -40 }, // 20 s
        { reason: "fullscreen", from: -10, to: null }, // never came back: 10 s until hand-in
        { reason: "blur", from: 5, to: 30 }, // after the hand-in: does not count
      ],
      handedIn,
    );

    const results = (await as(() => getQuizResults(db, admin, quizId)))!;
    const row = (id: string) => results.rows.find((r) => r.studentId === id)!;

    expect(row(sari.id).away).toMatchObject({ count: 2, totalMs: 30_000, longestMs: 20_000 });
    expect(row(tono.id).away).toMatchObject({ count: 0, totalMs: 0 });
    expect(row(results.rows.find((r) => r.state === "not_started")!.studentId).away).toBeNull();

    const lines = buildResultsCsv(results).replace(/^﻿/, "").trimEnd().split("\r\n");
    const header = lines[0].split(",");
    const cells = (name: string) => lines.find((l) => l.startsWith(name + ","))!.split(",");
    const col = (name: string) => header.indexOf(name);
    expect(cells("Sari")[col("Times away")]).toBe("2");
    expect(cells("Sari")[col("Seconds away")]).toBe("30");
    expect(cells("Tono")[col("Times away")]).toBe("0");
    expect(cells("Uci")[col("Times away")]).toBe("");
  });

  it("lists each absence in the attempt review, oldest first", async () => {
    const quizId = await publishedQuiz();
    const vina = await addStudent("Vina");
    const attempt = await finishedAttempt(vina.ctx, quizId);
    await putPeriods(
      attempt.id,
      [
        { reason: "blur", from: -30, to: -20 },
        { reason: "hidden", from: -100, to: -70 },
      ],
      attempt.submittedAt!,
    );

    const review = (await as(() => getAttemptReview(db, admin, quizId, attempt.id)))!;
    expect(review.away.count).toBe(2);
    expect(review.away.totalMs).toBe(40_000);
    expect(review.away.entries.map((e) => [e.reason, e.ms])).toEqual([
      ["hidden", 30_000],
      ["blur", 10_000],
    ]);
  });

  it("measures an attempt still in progress up to now, and shows a student who never left as none", async () => {
    const quizId = await publishedQuiz();
    const wati = await addStudent("Wati");
    const { attemptId } = await as(() => startAttempt(db, wati.ctx, quizId));

    let results = (await as(() => getQuizResults(db, admin, quizId)))!;
    expect(results.rows.find((r) => r.studentId === wati.id)).toMatchObject({ state: "in_progress", away: { count: 0 } });

    await as(() => reportAway(db, wati.ctx, attemptId, "hidden")); // still away
    results = (await as(() => getQuizResults(db, admin, quizId)))!;
    const away = results.rows.find((r) => r.studentId === wati.id)!.away!;
    expect(away.count).toBe(1);
    expect(away.entries[0].neverReturned).toBe(true);
    const review = (await as(() => getAttemptReview(db, admin, quizId, attemptId)))!;
    expect(review.away.entries[0].reason).toBe("hidden");
  });

  it("does not let one school see another's away records", async () => {
    const quizId = await publishedQuiz();
    const xena = await addStudent("Xena");
    const attempt = await finishedAttempt(xena.ctx, quizId);
    await putPeriods(attempt.id, [{ reason: "hidden", from: -30, to: -10 }], attempt.submittedAt!);
    const other = await seedSchool(db);
    const outsider: Ctx = { schoolId: other.school.id, userId: other.teacher.id };

    expect(await as(() => getAttemptReview(db, outsider, quizId, attempt.id))).toBeNull();
    expect(await as(() => getQuizResults(db, outsider, quizId))).toBeNull();
    // The quiz itself is untouched for its own school.
    expect(await as(() => getQuiz(db, admin.schoolId, quizId))).not.toBeNull();
  });

  it("says 'not recorded', not 'none', for an attempt started before time away was tracked", async () => {
    const quizId = await publishedQuiz();
    const old = await addStudent("Oki");
    const fresh = await addStudent("Puji");

    // An attempt from before the feature: created directly, so it is not flagged as tracked.
    const [legacy] = await db
      .insert(schema.attempts)
      .values({ schoolId: w.school.id, quizId, studentId: old.id })
      .returning();
    expect(legacy.awayTracked).toBe(false);
    await as(() => submitAttempt(db, old.ctx, legacy.id, {}));
    // Starting an attempt now does flag it.
    const started = await finishedAttempt(fresh.ctx, quizId);
    expect(started.awayTracked).toBe(true);

    const results = (await as(() => getQuizResults(db, admin, quizId)))!;
    const row = (id: string) => results.rows.find((r) => r.studentId === id)!;
    expect(row(old.id).away).toMatchObject({ tracked: false, count: 0 });
    expect(row(fresh.id).away).toMatchObject({ tracked: true, count: 0 });

    const review = (await as(() => getAttemptReview(db, admin, quizId, legacy.id)))!;
    expect(review.away.tracked).toBe(false);

    // The CSV leaves it blank: 0 would claim the student never left.
    const lines = buildResultsCsv(results).replace(/^﻿/, "").trimEnd().split("\r\n");
    const header = lines[0].split(",");
    const cells = (name: string) => lines.find((l) => l.startsWith(name + ","))!.split(",");
    expect(cells("Oki")[header.indexOf("Times away")]).toBe("");
    expect(cells("Oki")[header.indexOf("Seconds away")]).toBe("");
    expect(cells("Puji")[header.indexOf("Times away")]).toBe("0");
  });

  it("goes away with the result when the teacher deletes a student's result", async () => {
    const { deleteStudentResult } = await import("@/features/results/service");
    const quizId = await publishedQuiz();
    const yani = await addStudent("Yani");
    const attempt = await finishedAttempt(yani.ctx, quizId);
    await putPeriods(attempt.id, [{ reason: "hidden", from: -30, to: -10 }], attempt.submittedAt!);

    await as(() => deleteStudentResult(db, admin, quizId, yani.id));
    const left = await db
      .select()
      .from(schema.attemptAwayPeriods)
      .where(eq(schema.attemptAwayPeriods.attemptId, attempt.id));
    expect(left).toEqual([]);
  });
});
