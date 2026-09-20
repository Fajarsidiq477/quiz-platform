import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ServiceError, type Ctx } from "@/features/errors";
import { questionInputSchema, type QuizInput } from "@/features/quizzes/schemas";
import { addQuestion, createQuiz, publishQuiz } from "@/features/quizzes/service";
import { reportAway, reportBack } from "@/features/student/away";
import { startAttempt, submitAttempt } from "@/features/student/service";
import { withSchool } from "@/db/tenant";
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
const { attemptAwayPeriods } = schema;

describe("time away from the quiz page", () => {
  let db: TestDb;
  let w: World;
  let admin: Ctx;
  let me: Ctx;
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
    admin = { schoolId: w.school.id, userId: w.teacher.id };
    me = { schoolId: w.school.id, userId: w.student.id };
  });

  const quizInput = (): QuizInput => ({
    title: "Networking",
    description: null,
    classId: w.cls.id,
    timeLimitMinutes: 30,
    opensAt: new Date(Date.now() - HOUR),
    closesAt: new Date(Date.now() + 24 * HOUR),
    maxAttempts: 5,
    shuffleQuestions: false,
    resultsVisibility: "after_close",
  });
  const question = questionInputSchema.parse({
    type: "true_false",
    prompt: "A switch works at layer 2.",
    points: "1",
    correct: true,
  });

  /** A fresh published quiz and an attempt of the seeded student that is still open. */
  async function openAttempt() {
    const { id } = await as(() => createQuiz(db, admin, quizInput()));
    await as(() => addQuestion(db, admin, id, question));
    await as(() => publishQuiz(db, admin, id));
    const { attemptId } = await as(() => startAttempt(db, me, id));
    return { quizId: id, attemptId };
  }
  const periods = (attemptId: string) =>
    db.select().from(attemptAwayPeriods).where(eq(attemptAwayPeriods.attemptId, attemptId));

  async function fails(promise: Promise<unknown>, code: string) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).code).toBe(code);
  }

  it("starts a period stamped by the database clock", async () => {
    const { attemptId } = await openAttempt();
    await as(() => reportAway(db, me, attemptId, "hidden"));

    const [row] = await periods(attemptId);
    expect(row).toMatchObject({ reason: "hidden", endedAt: null });
    expect(Math.abs(row.startedAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("ignores a repeated 'I left': one open period, however many times it is reported", async () => {
    const { attemptId } = await openAttempt();
    await as(() => reportAway(db, me, attemptId, "hidden"));
    await as(() => reportAway(db, me, attemptId, "hidden"));
    await as(() => reportAway(db, me, attemptId, "blur"));

    const rows = await periods(attemptId);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe("hidden"); // the first reason stands
  });

  it("ends the period when the student is back, and a later absence is a new period", async () => {
    const { attemptId } = await openAttempt();
    await as(() => reportAway(db, me, attemptId, "blur"));
    await as(() => reportBack(db, me, attemptId));
    await as(() => reportBack(db, me, attemptId)); // a replay changes nothing

    const [first] = await periods(attemptId);
    expect(first.endedAt).not.toBeNull();
    expect(first.endedAt!.getTime()).toBeGreaterThanOrEqual(first.startedAt.getTime());

    await as(() => reportAway(db, me, attemptId, "fullscreen"));
    const rows = await periods(attemptId);
    expect(rows.map((r) => r.reason).sort()).toEqual(["blur", "fullscreen"]);
    expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1);
  });

  it("does nothing when told 'I am back' with no open period", async () => {
    const { attemptId } = await openAttempt();
    await as(() => reportBack(db, me, attemptId));
    expect(await periods(attemptId)).toEqual([]);
  });

  it("is refused once the attempt is handed in, but 'I am back' after hand-in is harmless", async () => {
    const { attemptId } = await openAttempt();
    await as(() => reportAway(db, me, attemptId, "hidden"));
    await as(() => submitAttempt(db, me, attemptId, {}));

    await fails(as(() => reportAway(db, me, attemptId, "hidden")), "invalid_state");
    await as(() => reportBack(db, me, attemptId));
    const [row] = await periods(attemptId);
    expect(row.endedAt).not.toBeNull();
  });

  it("is refused after the deadline plus grace", async () => {
    const { attemptId } = await openAttempt();
    await withoutTriggers(db, () =>
      db.execute(
        sql`update attempts set started_at = now() - interval '3 hours', deadline_at = now() - interval '1 minute' where id = ${attemptId}`,
      ),
    );
    await fails(as(() => reportAway(db, me, attemptId, "hidden")), "invalid_state");
    expect(await periods(attemptId)).toEqual([]);
  });

  it("only lets a student report on their own attempt", async () => {
    const { attemptId } = await openAttempt();
    const [other] = await db
      .insert(schema.users)
      .values({ schoolId: w.school.id, email: `o-${Math.random()}@example.test`, name: "Other", role: "student" })
      .returning();
    const stranger = { schoolId: w.school.id, userId: other.id };

    await fails(as(() => reportAway(db, stranger, attemptId, "hidden")), "not_found");
    await fails(as(() => reportBack(db, stranger, attemptId)), "not_found");
    await fails(as(() => reportAway(db, me, "not-an-id", "hidden")), "not_found");
    expect(await periods(attemptId)).toEqual([]);
  });

  it("is invisible to another school (row-level security)", async () => {
    const { attemptId } = await openAttempt();
    await as(() => reportAway(db, me, attemptId, "hidden"));
    const other = await seedSchool(db);

    const seen = await as(() =>
      withSchool(db, other.school.id, (tx) => tx.select().from(attemptAwayPeriods)),
    );
    expect(seen).toEqual([]);
    const own = await as(() => withSchool(db, w.school.id, (tx) => tx.select().from(attemptAwayPeriods)));
    expect(own.length).toBeGreaterThan(0);
  });

  describe("the database itself (a student cannot forge it)", () => {
    it("overwrites any start or end time sent with a new period", async () => {
      const { attemptId } = await openAttempt();
      const [row] = await db
        .insert(attemptAwayPeriods)
        .values({
          schoolId: w.school.id,
          attemptId,
          reason: "hidden",
          startedAt: new Date("2020-01-01T00:00:00Z"),
          endedAt: new Date("2020-01-01T00:00:01Z"),
        })
        .returning();
      expect(row.endedAt).toBeNull();
      expect(Math.abs(row.startedAt.getTime() - Date.now())).toBeLessThan(60_000);
    });

    it("lets a period be ended once, at the database's now, and nothing else be changed", async () => {
      const { attemptId } = await openAttempt();
      const [row] = await db
        .insert(attemptAwayPeriods)
        .values({ schoolId: w.school.id, attemptId, reason: "hidden" })
        .returning();
      const id = eq(attemptAwayPeriods.id, row.id);

      await expectDbError(
        db.update(attemptAwayPeriods).set({ startedAt: new Date("2020-01-01T00:00:00Z") }).where(id),
        /only the end time can be set/,
      );
      await expectDbError(
        db.update(attemptAwayPeriods).set({ reason: "blur" }).where(id),
        /only the end time can be set/,
      );

      // A forged (earlier) end time is replaced by the database's own clock.
      const [ended] = await db
        .update(attemptAwayPeriods)
        .set({ endedAt: new Date(row.startedAt.getTime() + 1000) })
        .where(id)
        .returning();
      expect(ended.endedAt!.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());
      expect(Math.abs(ended.endedAt!.getTime() - Date.now())).toBeLessThan(60_000);

      await expectDbError(
        db.update(attemptAwayPeriods).set({ endedAt: new Date() }).where(id),
        /already ended/,
      );
    });

    it("refuses a new period on an attempt that is not open", async () => {
      const { attemptId } = await openAttempt();
      await as(() => submitAttempt(db, me, attemptId, {}));
      await expectDbError(
        db.insert(attemptAwayPeriods).values({ schoolId: w.school.id, attemptId, reason: "hidden" }),
        /not in progress/,
      );
    });

    it("only allows the three known reasons", async () => {
      const { attemptId } = await openAttempt();
      await expectDbError(
        db.execute(
          sql`insert into attempt_away_periods (school_id, attempt_id, reason) values (${w.school.id}, ${attemptId}, 'vacation')`,
        ),
        /attempt_away_reason_ck/,
      );
    });

    it("goes away with the attempt", async () => {
      const { attemptId } = await openAttempt();
      await as(() => reportAway(db, me, attemptId, "hidden"));
      await db.delete(schema.attempts).where(eq(schema.attempts.id, attemptId));
      expect(await periods(attemptId)).toEqual([]);
    });
  });
});
