import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { answers, attempts, classes, enrollments, quizzes } from "@/db/schema";
import { withSchool } from "@/db/tenant";
import type { AnyPgDb, Tx } from "@/db/types";
import { ServiceError, type Ctx } from "../errors";
import { loadQuizItems, type QuizItem } from "../quizzes/service";
import type { QuestionType } from "../quizzes/schemas";
import { parseAnswer } from "./answers";
import { canSeeResults, gradeAnswer, seededShuffle, type StoredResponse } from "./grading";

// The database refuses answer writes and submits later than this after the deadline (a trigger),
// which leaves room for the last autosave and the automatic submit to reach the server.
export const GRACE_MS = 5000;

type AttemptRow = typeof attempts.$inferSelect;
type QuizRow = typeof quizzes.$inferSelect;

const isUuid = (v: string) => z.uuid().safeParse(v).success;
const assertUuid = (v: string, message: string) => {
  if (!isUuid(v)) throw new ServiceError(message, "not_found");
};

/** Time is always the database clock, never the browser's or this server's. */
async function dbNowMs(tx: Tx): Promise<number> {
  const result: unknown = await tx.execute(sql`select (extract(epoch from now()) * 1000)::float8 as now_ms`);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { now_ms: number }[];
  return Number(rows[0].now_ms);
}

const remainingMsSql = sql<number>`(extract(epoch from (${attempts.deadlineAt} - now())) * 1000)::float8`;
const nowMsSql = sql<number>`(extract(epoch from now()) * 1000)::float8`;

// ---------------------------------------------------------------------------------------------
// Types shown to the student
// ---------------------------------------------------------------------------------------------

export type Phase = "in_progress" | "available" | "upcoming" | "completed" | "missed";

export type StudentQuiz = {
  id: string;
  title: string;
  description: string | null;
  className: string;
  status: QuizRow["status"];
  opensAt: Date | null;
  closesAt: Date | null;
  timeLimitMinutes: number | null;
  questionCount: number;
  maxAttempts: number;
  attemptsUsed: number;
  openAttemptId: string | null;
  /** When the student may see their score and the answers. */
  resultsVisibility: QuizRow["resultsVisibility"];
  phase: Phase;
  latestAttempt: {
    id: string;
    status: AttemptRow["status"];
    score: number | null;
    maxScore: number | null;
    /** False when the quiz hides results for now (or ever). */
    resultsVisible: boolean;
  } | null;
};

export type TakingItem = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  /** Deliberately without `isCorrect`: the answer key never reaches the browser during a quiz. */
  options: { id: string; text: string }[];
};

export type AttemptTaking = {
  kind: "taking";
  attemptId: string;
  quiz: { id: string; title: string; description: string | null };
  /** Milliseconds left by the database clock when this was loaded. Zero or less = time is up. */
  remainingMs: number;
  items: TakingItem[];
  answers: Record<string, { optionIds?: string[]; text?: string }>;
};

export type ReviewItem = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  pointsAwarded: number;
  isCorrect: boolean;
  answered: boolean;
  explanation: string | null;
  options: { id: string; text: string; isCorrect: boolean; selected: boolean }[];
  yourText: string | null;
  acceptedAnswers: string[] | null;
};

export type AttemptResult = {
  kind: "result";
  attemptId: string;
  quiz: { id: string; title: string };
  status: AttemptRow["status"];
  attemptNo: number;
  startedAt: Date;
  submittedAt: Date | null;
  visible: boolean;
  /** Why the score is hidden, when it is. */
  hiddenReason: string | null;
  score: number | null;
  maxScore: number | null;
  items: ReviewItem[] | null;
};

// ---------------------------------------------------------------------------------------------
// Attempts: loading, finishing, grading
// ---------------------------------------------------------------------------------------------

async function loadOwnAttempt(tx: Tx, ctx: Ctx, attemptId: string, lock = false) {
  const query = tx
    .select({ attempt: attempts, remainingMs: remainingMsSql, nowMs: nowMsSql })
    .from(attempts)
    .where(
      and(
        eq(attempts.id, attemptId),
        eq(attempts.studentId, ctx.userId),
        eq(attempts.schoolId, ctx.schoolId),
      ),
    )
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new ServiceError("Attempt not found", "not_found");
  return row;
}

async function loadQuizOf(tx: Tx, ctx: Ctx, quizId: string): Promise<QuizRow> {
  // Not filtered by archived: a student keeps access to the results of their own attempts.
  const [quiz] = await tx
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)))
    .limit(1);
  if (!quiz) throw new ServiceError("Quiz not found", "not_found");
  return quiz;
}

/**
 * Grades a finished attempt and marks it graded. Runs exactly once per attempt, inside the same
 * transaction that moved it out of in_progress, so a replayed submit cannot score it twice.
 */
async function gradeAttempt(tx: Tx, ctx: Ctx, attempt: Pick<AttemptRow, "id" | "quizId">) {
  const items = await loadQuizItems(tx, ctx.schoolId, attempt.quizId);
  const saved = await tx
    .select({ id: answers.id, itemId: answers.quizQuestionId, response: answers.response })
    .from(answers)
    .where(and(eq(answers.attemptId, attempt.id), eq(answers.schoolId, ctx.schoolId)));

  let total = 0;
  for (const item of items) {
    const answer = saved.find((s) => s.itemId === item.id);
    const grade = gradeAnswer(item, answer?.response as StoredResponse);
    total += grade.pointsAwarded;
    if (answer) {
      await tx
        .update(answers)
        .set({ isCorrect: grade.isCorrect, pointsAwarded: grade.pointsAwarded.toFixed(2) })
        .where(and(eq(answers.id, answer.id), eq(answers.schoolId, ctx.schoolId)));
    }
  }
  await tx
    .update(attempts)
    .set({ status: "graded", score: total.toFixed(2) })
    .where(and(eq(attempts.id, attempt.id), eq(attempts.schoolId, ctx.schoolId)));
}

/**
 * Ends an in-progress attempt: `submitted` if it is still inside the deadline plus grace, otherwise
 * `expired`, then grades it. The single guarded UPDATE is what makes this idempotent: a repeat
 * (double click, retry, or the timer and the button racing) matches no row and does nothing.
 * Returns whether this call was the one that ended it.
 */
async function finishAttempt(tx: Tx, ctx: Ctx, attempt: Pick<AttemptRow, "id" | "quizId">) {
  const moved = await tx
    .update(attempts)
    .set({
      status: sql`(case when now() <= ${attempts.deadlineAt} + interval '5 seconds'
                        then 'submitted' else 'expired' end)::attempt_status`,
    })
    .where(
      and(
        eq(attempts.id, attempt.id),
        eq(attempts.studentId, ctx.userId),
        eq(attempts.schoolId, ctx.schoolId),
        eq(attempts.status, "in_progress"),
      ),
    )
    .returning({ id: attempts.id });
  if (moved.length === 0) return false;
  await gradeAttempt(tx, ctx, attempt);
  return true;
}

/**
 * Ends this student's attempts whose time ran out long ago. There is no background worker yet, so
 * this runs whenever the student loads a page; without it an abandoned attempt would stay open and
 * block a new one. The 5 second grace is left alone so an in-flight final save is not cut off.
 */
async function finishOverdueAttempts(tx: Tx, ctx: Ctx) {
  const overdue = await tx
    .select({ id: attempts.id, quizId: attempts.quizId })
    .from(attempts)
    .where(
      and(
        eq(attempts.studentId, ctx.userId),
        eq(attempts.schoolId, ctx.schoolId),
        eq(attempts.status, "in_progress"),
        sql`${attempts.deadlineAt} + interval '5 seconds' < now()`,
      ),
    );
  for (const attempt of overdue) await finishAttempt(tx, ctx, attempt);
}

// ---------------------------------------------------------------------------------------------
// Listing quizzes
// ---------------------------------------------------------------------------------------------

export function phaseOf(
  quiz: Pick<StudentQuiz, "status" | "opensAt" | "closesAt" | "maxAttempts" | "attemptsUsed" | "openAttemptId">,
  nowMs: number,
): Phase {
  const open =
    quiz.status === "published" &&
    quiz.opensAt !== null &&
    quiz.closesAt !== null &&
    nowMs >= quiz.opensAt.getTime() &&
    nowMs < quiz.closesAt.getTime();

  if (quiz.openAttemptId) return "in_progress";
  if (open && quiz.attemptsUsed < quiz.maxAttempts) return "available";
  if (quiz.status === "published" && quiz.opensAt !== null && nowMs < quiz.opensAt.getTime()) {
    return "upcoming";
  }
  return quiz.attemptsUsed > 0 ? "completed" : "missed";
}

async function loadStudentQuizzes(tx: Tx, ctx: Ctx, onlyQuizId?: string): Promise<StudentQuiz[]> {
  const nowMs = await dbNowMs(tx);

  const rows = await tx
    .select({
      id: quizzes.id,
      title: quizzes.title,
      description: quizzes.description,
      status: quizzes.status,
      opensAt: quizzes.opensAt,
      closesAt: quizzes.closesAt,
      timeLimitSeconds: quizzes.timeLimitSeconds,
      maxAttempts: quizzes.maxAttempts,
      resultsVisibility: quizzes.resultsVisibility,
      className: classes.name,
      // Written out in full: never rely on Drizzle qualifying a column inside a raw subquery.
      questionCount: sql<number>`(select count(*)::int from quiz_questions qq
        where qq.quiz_id = "quizzes"."id")`,
      attemptsUsed: sql<number>`(select count(*)::int from attempts a
        where a.quiz_id = "quizzes"."id" and a.student_id = ${ctx.userId})`,
      openAttemptId: sql<string | null>`(select a.id from attempts a
        where a.quiz_id = "quizzes"."id" and a.student_id = ${ctx.userId}
          and a.status = 'in_progress' limit 1)`,
    })
    .from(quizzes)
    .innerJoin(classes, and(eq(classes.id, quizzes.classId), eq(classes.schoolId, quizzes.schoolId)))
    // Only quizzes of classes the student is actively enrolled in.
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.classId, quizzes.classId),
        eq(enrollments.schoolId, quizzes.schoolId),
        eq(enrollments.studentId, ctx.userId),
        eq(enrollments.status, "active"),
      ),
    )
    .where(
      and(
        eq(quizzes.schoolId, ctx.schoolId),
        isNull(quizzes.archivedAt),
        inArray(quizzes.status, ["published", "closed"]),
        onlyQuizId ? eq(quizzes.id, onlyQuizId) : undefined,
      ),
    )
    .orderBy(desc(quizzes.opensAt), desc(quizzes.createdAt));

  const latest = rows.length
    ? await tx
        .select({
          id: attempts.id,
          quizId: attempts.quizId,
          status: attempts.status,
          score: attempts.score,
          maxScore: attempts.maxScore,
        })
        .from(attempts)
        .where(
          and(
            eq(attempts.studentId, ctx.userId),
            eq(attempts.schoolId, ctx.schoolId),
            inArray(
              attempts.quizId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .orderBy(desc(attempts.startedAt))
    : [];

  return rows.map((row) => {
    const mine = latest.find((a) => a.quizId === row.id) ?? null;
    const card = {
      id: row.id,
      title: row.title,
      description: row.description,
      className: row.className,
      status: row.status,
      opensAt: row.opensAt,
      closesAt: row.closesAt,
      timeLimitMinutes: row.timeLimitSeconds === null ? null : Math.round(row.timeLimitSeconds / 60),
      questionCount: row.questionCount,
      maxAttempts: row.maxAttempts,
      attemptsUsed: row.attemptsUsed,
      openAttemptId: row.openAttemptId,
      resultsVisibility: row.resultsVisibility,
    };
    const finished = mine && mine.status !== "in_progress";
    const visible = canSeeResults(row.resultsVisibility, row, nowMs);
    return {
      ...card,
      phase: phaseOf(card, nowMs),
      latestAttempt: mine
        ? {
            id: mine.id,
            status: mine.status,
            score: finished && visible && mine.score !== null ? Number(mine.score) : null,
            maxScore: finished && visible && mine.maxScore !== null ? Number(mine.maxScore) : null,
            resultsVisible: !!finished && visible,
          }
        : null,
    };
  });
}

export async function listMyQuizzes(db: AnyPgDb, ctx: Ctx): Promise<StudentQuiz[]> {
  return withSchool(db, ctx.schoolId, async (tx) => {
    await finishOverdueAttempts(tx, ctx);
    return loadStudentQuizzes(tx, ctx);
  });
}

export type StudentQuizDetail = {
  quiz: StudentQuiz;
  attempts: {
    id: string;
    attemptNo: number;
    status: AttemptRow["status"];
    startedAt: Date;
    submittedAt: Date | null;
    score: number | null;
    maxScore: number | null;
    resultsVisible: boolean;
  }[];
};

export async function getMyQuiz(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
): Promise<StudentQuizDetail | null> {
  if (!isUuid(quizId)) return null;
  return withSchool(db, ctx.schoolId, async (tx) => {
    await finishOverdueAttempts(tx, ctx);
    const [quiz] = await loadStudentQuizzes(tx, ctx, quizId);
    if (!quiz) return null;

    const nowMs = await dbNowMs(tx);
    const [raw] = await tx.select().from(quizzes).where(eq(quizzes.id, quizId)).limit(1);
    const visible = canSeeResults(raw.resultsVisibility, raw, nowMs);

    const mine = await tx
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.quizId, quizId),
          eq(attempts.studentId, ctx.userId),
          eq(attempts.schoolId, ctx.schoolId),
        ),
      )
      .orderBy(desc(attempts.attemptNo));

    return {
      quiz,
      attempts: mine.map((a) => {
        const finished = a.status !== "in_progress";
        return {
          id: a.id,
          attemptNo: a.attemptNo,
          status: a.status,
          startedAt: a.startedAt,
          submittedAt: a.submittedAt,
          score: finished && visible && a.score !== null ? Number(a.score) : null,
          maxScore: finished && visible && a.maxScore !== null ? Number(a.maxScore) : null,
          resultsVisible: finished && visible,
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------------------------

/**
 * Starts an attempt, or returns the one already open. Safe to call twice (double click, retry,
 * two tabs): the database allows only one in-progress attempt per student per quiz, so the second
 * caller simply gets the first one's id. The start time and deadline are set by the database.
 */
export async function startAttempt(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
): Promise<{ attemptId: string; created: boolean }> {
  assertUuid(quizId, "Quiz not found");
  return withSchool(db, ctx.schoolId, async (tx) => {
    // An abandoned attempt must be ended first, or it would block starting a new one.
    await finishOverdueAttempts(tx, ctx);

    const [quiz] = await loadStudentQuizzes(tx, ctx, quizId);
    if (!quiz) {
      throw new ServiceError("This quiz is not available to you", "not_found");
    }
    if (quiz.openAttemptId) return { attemptId: quiz.openAttemptId, created: false };

    const nowMs = await dbNowMs(tx);
    if (quiz.status !== "published" || quiz.phase === "missed" || (quiz.closesAt && nowMs >= quiz.closesAt.getTime())) {
      throw new ServiceError("This quiz is closed", "invalid_state");
    }
    if (quiz.opensAt && nowMs < quiz.opensAt.getTime()) {
      throw new ServiceError("This quiz has not opened yet", "invalid_state");
    }
    if (quiz.attemptsUsed >= quiz.maxAttempts) {
      throw new ServiceError(
        `You have used all ${quiz.maxAttempts} ${quiz.maxAttempts === 1 ? "attempt" : "attempts"} for this quiz`,
        "invalid_state",
      );
    }
    if (quiz.questionCount === 0) {
      throw new ServiceError("This quiz has no questions yet", "invalid_state");
    }

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${attempts.attemptNo}), 0)::int + 1` })
      .from(attempts)
      .where(
        and(
          eq(attempts.quizId, quizId),
          eq(attempts.studentId, ctx.userId),
          eq(attempts.schoolId, ctx.schoolId),
        ),
      );

    // startedAt / deadlineAt are overwritten by a database trigger; nothing here sets a time.
    const inserted = await tx
      .insert(attempts)
      .values({ schoolId: ctx.schoolId, quizId, studentId: ctx.userId, attemptNo: next })
      .onConflictDoNothing()
      .returning({ id: attempts.id });
    if (inserted.length > 0) return { attemptId: inserted[0].id, created: true };

    // Lost a race with a concurrent start: use the attempt that won.
    const [open] = await tx
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.quizId, quizId),
          eq(attempts.studentId, ctx.userId),
          eq(attempts.schoolId, ctx.schoolId),
          eq(attempts.status, "in_progress"),
        ),
      )
      .limit(1);
    if (!open) throw new ServiceError("Could not start the quiz. Please try again.", "conflict");
    return { attemptId: open.id, created: false };
  });
}

// ---------------------------------------------------------------------------------------------
// Taking a quiz and seeing the result
// ---------------------------------------------------------------------------------------------

async function loadSavedAnswers(tx: Tx, ctx: Ctx, attemptId: string) {
  const saved = await tx
    .select({ itemId: answers.quizQuestionId, response: answers.response })
    .from(answers)
    .where(and(eq(answers.attemptId, attemptId), eq(answers.schoolId, ctx.schoolId)));
  return Object.fromEntries(saved.map((s) => [s.itemId, s.response as StoredResponse])) as Record<
    string,
    { optionIds?: string[]; text?: string }
  >;
}

function toReview(item: QuizItem, response: StoredResponse, graded: { isCorrect: boolean; pointsAwarded: number }): ReviewItem {
  const selected = new Set(response?.optionIds ?? []);
  const text = response?.text?.trim() ?? "";
  const answered =
    item.type === "short_answer" ? text !== "" : selected.size > 0;
  return {
    id: item.id,
    type: item.type,
    prompt: item.prompt,
    points: Number(item.points),
    pointsAwarded: graded.pointsAwarded,
    isCorrect: graded.isCorrect,
    answered,
    explanation: item.explanation,
    options: item.options.map((o) => ({
      id: o.id,
      text: o.text,
      isCorrect: o.isCorrect,
      selected: selected.has(o.id),
    })),
    yourText: item.type === "short_answer" ? (text || null) : null,
    acceptedAnswers: item.acceptedAnswers,
  };
}

/**
 * What the attempt page shows: the questions to answer while time remains, otherwise the result.
 * An attempt whose time ran out is ended here first, so the student never lands on a dead form.
 */
export async function getAttemptPage(
  db: AnyPgDb,
  ctx: Ctx,
  attemptId: string,
): Promise<AttemptTaking | AttemptResult | null> {
  if (!isUuid(attemptId)) return null;
  return withSchool(db, ctx.schoolId, async (tx) => {
    await finishOverdueAttempts(tx, ctx);

    let row;
    try {
      row = await loadOwnAttempt(tx, ctx, attemptId);
    } catch (err) {
      if (err instanceof ServiceError && err.code === "not_found") return null;
      throw err;
    }
    const { attempt, remainingMs, nowMs } = row;
    const quiz = await loadQuizOf(tx, ctx, attempt.quizId);
    const items = await loadQuizItems(tx, ctx.schoolId, attempt.quizId);
    const saved = await loadSavedAnswers(tx, ctx, attempt.id);

    if (attempt.status === "in_progress") {
      const ordered = quiz.shuffleQuestions ? seededShuffle(items, attempt.id) : items;
      return {
        kind: "taking",
        attemptId: attempt.id,
        quiz: { id: quiz.id, title: quiz.title, description: quiz.description },
        remainingMs,
        items: ordered.map((item) => ({
          id: item.id,
          type: item.type,
          prompt: item.prompt,
          points: Number(item.points),
          options: item.options.map((o) => ({ id: o.id, text: o.text })),
        })),
        answers: saved,
      };
    }

    const visible = canSeeResults(quiz.resultsVisibility, quiz, nowMs);
    const base = {
      kind: "result" as const,
      attemptId: attempt.id,
      quiz: { id: quiz.id, title: quiz.title },
      status: attempt.status,
      attemptNo: attempt.attemptNo,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
    };
    if (!visible) {
      return {
        ...base,
        visible: false,
        hiddenReason:
          quiz.resultsVisibility === "never"
            ? "Your teacher has chosen not to show results for this quiz."
            : "Your answers are in. Results will be shown after the quiz closes.",
        score: null,
        maxScore: null,
        items: null,
      };
    }
    return {
      ...base,
      visible: true,
      hiddenReason: null,
      score: attempt.score === null ? null : Number(attempt.score),
      maxScore: attempt.maxScore === null ? null : Number(attempt.maxScore),
      items: items.map((item) => toReview(item, saved[item.id], gradeAnswer(item, saved[item.id]))),
    };
  });
}

/**
 * Saves one answer (a repeat converges on the same row, so retries are safe). Returns the time
 * left by the database clock so the browser's countdown can re-sync.
 */
export async function saveAnswer(
  db: AnyPgDb,
  ctx: Ctx,
  attemptId: string,
  itemId: string,
  rawResponse: unknown,
): Promise<{ remainingMs: number }> {
  assertUuid(attemptId, "Attempt not found");
  assertUuid(itemId, "Question not found");
  return withSchool(db, ctx.schoolId, async (tx) => {
    // Locked so a save and a submit of the same attempt cannot interleave.
    const { attempt, remainingMs } = await loadOwnAttempt(tx, ctx, attemptId, true);
    if (attempt.status !== "in_progress") {
      throw new ServiceError("This attempt has already been submitted", "invalid_state");
    }
    if (remainingMs < -GRACE_MS) throw new ServiceError("Time is up", "invalid_state");

    const item = (await loadQuizItems(tx, ctx.schoolId, attempt.quizId)).find((i) => i.id === itemId);
    if (!item) throw new ServiceError("Question not found", "not_found");
    const response = parseAnswer(item, rawResponse);

    await tx
      .insert(answers)
      .values({
        schoolId: ctx.schoolId,
        attemptId: attempt.id,
        quizId: attempt.quizId,
        quizQuestionId: item.id,
        response,
      })
      .onConflictDoUpdate({
        target: [answers.attemptId, answers.quizQuestionId],
        set: { response },
      });
    return { remainingMs };
  });
}

/**
 * Hands in the attempt. `snapshot` is the browser's full set of answers at that moment; saving it
 * first means a lost autosave cannot lose an answer. Idempotent: submitting an attempt that is
 * already finished changes nothing and returns the same attempt.
 */
export async function submitAttempt(
  db: AnyPgDb,
  ctx: Ctx,
  attemptId: string,
  snapshot?: Record<string, unknown>,
): Promise<{ attemptId: string }> {
  assertUuid(attemptId, "Attempt not found");
  return withSchool(db, ctx.schoolId, async (tx) => {
    const { attempt, remainingMs } = await loadOwnAttempt(tx, ctx, attemptId, true);
    if (attempt.status !== "in_progress") return { attemptId: attempt.id }; // a replay

    // Answers arriving later than the deadline plus grace are not accepted (the database would
    // refuse them anyway); the attempt is then ended as expired with what was saved in time.
    if (snapshot && remainingMs >= -GRACE_MS) {
      const items = await loadQuizItems(tx, ctx.schoolId, attempt.quizId);
      for (const [itemId, raw] of Object.entries(snapshot)) {
        const item = items.find((i) => i.id === itemId);
        if (!item) throw new ServiceError("Question not found", "not_found");
        const response = parseAnswer(item, raw);
        await tx
          .insert(answers)
          .values({
            schoolId: ctx.schoolId,
            attemptId: attempt.id,
            quizId: attempt.quizId,
            quizQuestionId: item.id,
            response,
          })
          .onConflictDoUpdate({
            target: [answers.attemptId, answers.quizQuestionId],
            set: { response },
          });
      }
    }

    await finishAttempt(tx, ctx, attempt);
    return { attemptId: attempt.id };
  });
}

