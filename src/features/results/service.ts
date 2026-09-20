import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { answers, attemptAwayPeriods, attempts, classes, enrollments, quizzes, users } from "@/db/schema";
import { withSchool } from "@/db/tenant";
import type { AnyPgDb, Tx } from "@/db/types";
import { NO_AWAY, summariseAway, type AwayReport } from "../attempts/away";
import { finishOverdueAttempts } from "../attempts/lifecycle";
import { toReview, type ReviewItem } from "../attempts/review";
import { ServiceError, type Ctx } from "../errors";
import type { QuestionType } from "../quizzes/schemas";
import { loadQuizItems, type QuizItem } from "../quizzes/service";
import { gradeAnswer, isAnswered, normalizeText, type StoredResponse } from "../student/grading";
import { dbNowMs } from "../student/service";

// The teacher's view of results. Rules that apply everywhere here:
//  - A student's RESULT is their latest FINISHED attempt (the teacher chose "latest"); an attempt
//    still in progress is shown as a state but does not replace it.
//  - Attempts whose time ran out are ended and graded first (there is no background worker yet),
//    so a number here is never stale.
//  - The teacher always sees scores and answers; the quiz's "results visibility" setting is only
//    about what students see.

type AttemptRow = typeof attempts.$inferSelect;
type QuizRow = typeof quizzes.$inferSelect;

const isUuid = (v: string) => z.uuid().safeParse(v).success;
const FINISHED = ["submitted", "expired", "graded"] as const;
const isFinished = (a: Pick<AttemptRow, "status">) => (FINISHED as readonly string[]).includes(a.status);
const percentOf = (score: number, max: number) => (max > 0 ? (score / max) * 100 : 0);

/** An attempt that ran out of time is ended with `submitted_at` set to exactly its deadline. */
const timedOut = (a: Pick<AttemptRow, "submittedAt" | "deadlineAt">) =>
  a.submittedAt !== null && a.submittedAt.getTime() === a.deadlineAt.getTime();

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export type ResultState = "not_started" | "in_progress" | "finished";

export type LatestResult = {
  attemptId: string;
  attemptNo: number;
  score: number;
  maxScore: number;
  percent: number;
  startedAt: Date;
  submittedAt: Date | null;
  timedOut: boolean;
};

export type ResultRow = {
  studentId: string;
  name: string;
  email: string;
  /** False for a student who has since left the class but has attempts on record. */
  enrolled: boolean;
  attemptsUsed: number;
  state: ResultState;
  openAttemptId: string | null;
  /**
   * Time away from the quiz page in the attempt shown here (the latest finished one, otherwise the
   * one in progress). Null when the student has no attempt.
   */
  away: AwayReport | null;
  latest: LatestResult | null;
  /** Points awarded per question in the latest finished attempt, keyed by quiz item id. */
  points: Record<string, number>;
};

export type QuestionStat = {
  itemId: string;
  position: number;
  type: QuestionType;
  prompt: string;
  points: number;
  /** Students with a result: the ones this question is measured over. */
  basis: number;
  answered: number;
  correct: number;
  percentCorrect: number | null;
  /** Choice questions: how many students picked each option. */
  options: { text: string; isCorrect: boolean; count: number }[];
  /** Short answers: the most common wrong answers, so accepted answers can be widened. */
  commonWrong: { text: string; count: number }[];
};

export type QuizResults = {
  quiz: {
    id: string;
    title: string;
    className: string;
    status: QuizRow["status"];
    maxAttempts: number;
    timeLimitMinutes: number | null;
    opensAt: Date | null;
    closesAt: Date | null;
    questionCount: number;
    maxScore: number;
  };
  rows: ResultRow[];
  summary: {
    enrolled: number;
    notStarted: number;
    inProgress: number;
    finished: number;
    /** Percentages over the students with a result; null when nobody has one. */
    average: number | null;
    highest: number | null;
    lowest: number | null;
  };
  items: { id: string; position: number; points: number }[];
  questions: QuestionStat[];
};

export type ResultQuizSummary = {
  id: string;
  title: string;
  className: string;
  status: QuizRow["status"];
  opensAt: Date | null;
  closesAt: Date | null;
  enrolled: number;
  started: number;
  inProgress: number;
  finished: number;
  average: number | null;
};

export type AttemptReview = {
  quiz: { id: string; title: string; className: string };
  student: { id: string; name: string; email: string };
  attempt: {
    id: string;
    attemptNo: number;
    inProgress: boolean;
    startedAt: Date;
    submittedAt: Date | null;
    timedOut: boolean;
    score: number | null;
    maxScore: number | null;
    percent: number | null;
  };
  /** Every time the student left the quiz page during this attempt, and for how long. */
  away: AwayReport;
  /** Null while the attempt is still in progress. */
  items: ReviewItem[] | null;
  /** All of this student's attempts on the quiz, newest first. */
  attempts: { id: string; attemptNo: number; inProgress: boolean; score: number | null; maxScore: number | null }[];
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export type Sort = "name" | "score";

export function parseSort(value: unknown): Sort {
  return value === "score" ? "score" : "name";
}

/** Name order, or highest result first with students who have no result last. */
export function sortRows(rows: ResultRow[], sort: Sort): ResultRow[] {
  const byName = (a: ResultRow, b: ResultRow) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.email.localeCompare(b.email);
  return [...rows].sort((a, b) => {
    if (sort === "score") {
      const pa = a.latest?.percent ?? -1;
      const pb = b.latest?.percent ?? -1;
      if (pa !== pb) return pb - pa;
    }
    return byName(a, b);
  });
}

function summarise(rows: ResultRow[], enrolled: number): QuizResults["summary"] {
  const percents = rows.filter((r) => r.latest).map((r) => r.latest!.percent);
  return {
    enrolled,
    notStarted: rows.filter((r) => r.enrolled && r.state === "not_started").length,
    inProgress: rows.filter((r) => r.state === "in_progress").length,
    finished: rows.filter((r) => r.latest !== null).length,
    average: percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : null,
    highest: percents.length ? Math.max(...percents) : null,
    lowest: percents.length ? Math.min(...percents) : null,
  };
}

/** For each student, the finished attempt with the highest attempt number. */
function latestFinishedByStudent(list: AttemptRow[]) {
  const latest = new Map<string, AttemptRow>();
  for (const a of list) {
    if (!isFinished(a)) continue;
    const current = latest.get(a.studentId);
    if (!current || a.attemptNo > current.attemptNo) latest.set(a.studentId, a);
  }
  return latest;
}

/**
 * Time away from the quiz page for each of the given attempts, by attempt id. An attempt still in
 * progress is measured up to the database's "now"; a finished one up to when it was handed in (or
 * its deadline, if time ran out), so a tab left hidden afterwards adds nothing.
 */
const UNTRACKED: AwayReport = { ...NO_AWAY, tracked: false };

async function loadAwayStats(
  tx: Tx,
  schoolId: string,
  list: AttemptRow[],
): Promise<Map<string, AwayReport>> {
  const out = new Map<string, AwayReport>();
  if (list.length === 0) return out;
  const rows = await tx
    .select({
      attemptId: attemptAwayPeriods.attemptId,
      reason: attemptAwayPeriods.reason,
      startedAt: attemptAwayPeriods.startedAt,
      endedAt: attemptAwayPeriods.endedAt,
    })
    .from(attemptAwayPeriods)
    .where(
      and(
        eq(attemptAwayPeriods.schoolId, schoolId),
        inArray(attemptAwayPeriods.attemptId, list.map((a) => a.id)),
      ),
    );
  const now = new Date(await dbNowMs(tx));
  for (const a of list) {
    const until = a.status === "in_progress" ? now : (a.submittedAt ?? a.deadlineAt);
    out.set(a.id, {
      ...summariseAway(rows.filter((r) => r.attemptId === a.id), until),
      tracked: a.awayTracked,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The index: every quiz with its completion numbers
// ---------------------------------------------------------------------------------------------

export async function listResultQuizzes(db: AnyPgDb, ctx: Ctx): Promise<ResultQuizSummary[]> {
  return withSchool(db, ctx.schoolId, async (tx) => {
    await finishOverdueAttempts(tx, ctx.schoolId, {});

    const rows = await tx
      .select({
        id: quizzes.id,
        title: quizzes.title,
        status: quizzes.status,
        opensAt: quizzes.opensAt,
        closesAt: quizzes.closesAt,
        classId: quizzes.classId,
        className: classes.name,
      })
      .from(quizzes)
      .innerJoin(classes, and(eq(classes.id, quizzes.classId), eq(classes.schoolId, quizzes.schoolId)))
      .where(
        and(
          eq(quizzes.schoolId, ctx.schoolId),
          isNull(quizzes.archivedAt),
          inArray(quizzes.status, ["published", "closed"]),
        ),
      )
      .orderBy(desc(quizzes.createdAt));
    if (rows.length === 0) return [];

    const enrolledByClass = await tx
      .select({ classId: enrollments.classId, n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(eq(enrollments.schoolId, ctx.schoolId), eq(enrollments.status, "active")))
      .groupBy(enrollments.classId);

    const all = await tx
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.schoolId, ctx.schoolId),
          inArray(
            attempts.quizId,
            rows.map((r) => r.id),
          ),
        ),
      );

    return rows.map((row) => {
      const mine = all.filter((a) => a.quizId === row.id);
      const latest = latestFinishedByStudent(mine);
      const percents = [...latest.values()].map((a) => percentOf(Number(a.score ?? 0), Number(a.maxScore ?? 0)));
      return {
        id: row.id,
        title: row.title,
        className: row.className,
        status: row.status,
        opensAt: row.opensAt,
        closesAt: row.closesAt,
        enrolled: enrolledByClass.find((e) => e.classId === row.classId)?.n ?? 0,
        started: new Set(mine.map((a) => a.studentId)).size,
        inProgress: new Set(mine.filter((a) => a.status === "in_progress").map((a) => a.studentId)).size,
        finished: latest.size,
        average: percents.length ? percents.reduce((a, b) => a + b, 0) / percents.length : null,
      };
    });
  });
}

// ---------------------------------------------------------------------------------------------
// One quiz: students, summary and per-question analysis
// ---------------------------------------------------------------------------------------------

function questionStats(
  items: QuizItem[],
  latestAttemptIds: string[],
  saved: { attemptId: string; itemId: string; response: unknown; isCorrect: boolean | null }[],
): QuestionStat[] {
  const basis = latestAttemptIds.length;
  return items.map((item) => {
    const mine = saved.filter((s) => s.itemId === item.id);
    const answeredRows = mine.filter((s) => isAnswered(item, s.response as StoredResponse));
    const correct = mine.filter((s) => s.isCorrect === true).length;

    const options = item.options.map((o) => ({
      text: o.text,
      isCorrect: o.isCorrect,
      count: answeredRows.filter((s) => ((s.response as StoredResponse)?.optionIds ?? []).includes(o.id)).length,
    }));

    // Wrong short answers, grouped ignoring case and spacing.
    const wrong = new Map<string, { text: string; count: number }>();
    if (item.type === "short_answer") {
      for (const s of answeredRows.filter((r) => r.isCorrect !== true)) {
        const text = ((s.response as StoredResponse)?.text ?? "").trim();
        const key = normalizeText(text);
        const entry = wrong.get(key);
        if (entry) entry.count++;
        else wrong.set(key, { text, count: 1 });
      }
    }
    const commonWrong = [...wrong.values()]
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
      .slice(0, 5);

    return {
      itemId: item.id,
      position: item.position,
      type: item.type,
      prompt: item.prompt,
      points: Number(item.points),
      basis,
      answered: answeredRows.length,
      correct,
      percentCorrect: basis > 0 ? (correct / basis) * 100 : null,
      options: item.type === "short_answer" ? [] : options,
      commonWrong,
    };
  });
}

export async function getQuizResults(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
): Promise<QuizResults | null> {
  if (!isUuid(quizId)) return null;
  return withSchool(db, ctx.schoolId, async (tx) => {
    await finishOverdueAttempts(tx, ctx.schoolId, { quizId });

    const [quiz] = await tx
      .select({ quiz: quizzes, className: classes.name })
      .from(quizzes)
      .innerJoin(classes, and(eq(classes.id, quizzes.classId), eq(classes.schoolId, quizzes.schoolId)))
      .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId), isNull(quizzes.archivedAt)))
      .limit(1);
    if (!quiz) return null;

    const items = await loadQuizItems(tx, ctx.schoolId, quizId);
    const list = await tx
      .select()
      .from(attempts)
      .where(and(eq(attempts.quizId, quizId), eq(attempts.schoolId, ctx.schoolId)))
      .orderBy(asc(attempts.attemptNo));

    // Everyone actively enrolled, plus anyone with attempts who has since left the class.
    const enrolledStudents = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(enrollments)
      .innerJoin(users, and(eq(users.id, enrollments.studentId), eq(users.schoolId, enrollments.schoolId)))
      .where(
        and(
          eq(enrollments.classId, quiz.quiz.classId),
          eq(enrollments.schoolId, ctx.schoolId),
          eq(enrollments.status, "active"),
        ),
      );
    const known = new Set(enrolledStudents.map((s) => s.id));
    const strayIds = [...new Set(list.map((a) => a.studentId))].filter((id) => !known.has(id));
    const strays = strayIds.length
      ? await tx
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(and(inArray(users.id, strayIds), eq(users.schoolId, ctx.schoolId)))
      : [];

    const latest = latestFinishedByStudent(list);
    const latestIds = [...latest.values()].map((a) => a.id);
    const awayByAttempt = await loadAwayStats(tx, ctx.schoolId, list);
    const saved = latestIds.length
      ? await tx
          .select({
            attemptId: answers.attemptId,
            itemId: answers.quizQuestionId,
            response: answers.response,
            isCorrect: answers.isCorrect,
            pointsAwarded: answers.pointsAwarded,
          })
          .from(answers)
          .where(and(eq(answers.schoolId, ctx.schoolId), inArray(answers.attemptId, latestIds)))
      : [];

    const rows: ResultRow[] = [
      ...enrolledStudents.map((s) => ({ ...s, enrolled: true })),
      ...strays.map((s) => ({ ...s, enrolled: false })),
    ].map((student) => {
      const mine = list.filter((a) => a.studentId === student.id);
      const open = mine.find((a) => a.status === "in_progress") ?? null;
      const finished = latest.get(student.id) ?? null;
      const shown = finished ?? open;
      const points: Record<string, number> = {};
      if (finished) {
        for (const s of saved.filter((x) => x.attemptId === finished.id)) {
          points[s.itemId] = Number(s.pointsAwarded ?? 0);
        }
      }
      return {
        studentId: student.id,
        name: student.name,
        email: student.email,
        enrolled: student.enrolled,
        attemptsUsed: mine.length,
        state: open ? "in_progress" : finished ? "finished" : "not_started",
        openAttemptId: open?.id ?? null,
        away: shown ? (awayByAttempt.get(shown.id) ?? UNTRACKED) : null,
        latest: finished
          ? {
              attemptId: finished.id,
              attemptNo: finished.attemptNo,
              score: Number(finished.score ?? 0),
              maxScore: Number(finished.maxScore ?? 0),
              percent: percentOf(Number(finished.score ?? 0), Number(finished.maxScore ?? 0)),
              startedAt: finished.startedAt,
              submittedAt: finished.submittedAt,
              timedOut: timedOut(finished),
            }
          : null,
        points,
      } satisfies ResultRow;
    });

    return {
      quiz: {
        id: quiz.quiz.id,
        title: quiz.quiz.title,
        className: quiz.className,
        status: quiz.quiz.status,
        maxAttempts: quiz.quiz.maxAttempts,
        timeLimitMinutes:
          quiz.quiz.timeLimitSeconds === null ? null : Math.round(quiz.quiz.timeLimitSeconds / 60),
        opensAt: quiz.quiz.opensAt,
        closesAt: quiz.quiz.closesAt,
        questionCount: items.length,
        maxScore: items.reduce((sum, i) => sum + Number(i.points), 0),
      },
      rows,
      summary: summarise(rows, enrolledStudents.length),
      items: items.map((i) => ({ id: i.id, position: i.position, points: Number(i.points) })),
      questions: questionStats(items, latestIds, saved),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// One attempt, question by question
// ---------------------------------------------------------------------------------------------

export async function getAttemptReview(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
  attemptId: string,
): Promise<AttemptReview | null> {
  if (!isUuid(quizId) || !isUuid(attemptId)) return null;
  return withSchool(db, ctx.schoolId, async (tx) => review(tx, ctx, quizId, attemptId));
}

async function review(tx: Tx, ctx: Ctx, quizId: string, attemptId: string): Promise<AttemptReview | null> {
  await finishOverdueAttempts(tx, ctx.schoolId, { quizId });

  const [found] = await tx
    .select({ attempt: attempts, quizTitle: quizzes.title, className: classes.name, name: users.name, email: users.email })
    .from(attempts)
    .innerJoin(quizzes, and(eq(quizzes.id, attempts.quizId), eq(quizzes.schoolId, attempts.schoolId)))
    .innerJoin(classes, and(eq(classes.id, quizzes.classId), eq(classes.schoolId, quizzes.schoolId)))
    .innerJoin(users, and(eq(users.id, attempts.studentId), eq(users.schoolId, attempts.schoolId)))
    .where(
      and(
        eq(attempts.id, attemptId),
        eq(attempts.quizId, quizId),
        eq(attempts.schoolId, ctx.schoolId),
        isNull(quizzes.archivedAt),
      ),
    )
    .limit(1);
  if (!found) return null;
  const { attempt } = found;
  const inProgress = attempt.status === "in_progress";

  const siblings = await tx
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.quizId, quizId),
        eq(attempts.studentId, attempt.studentId),
        eq(attempts.schoolId, ctx.schoolId),
      ),
    )
    .orderBy(desc(attempts.attemptNo));

  let items: ReviewItem[] | null = null;
  if (!inProgress) {
    const quizItems = await loadQuizItems(tx, ctx.schoolId, quizId);
    const saved = await tx
      .select({ itemId: answers.quizQuestionId, response: answers.response })
      .from(answers)
      .where(and(eq(answers.attemptId, attempt.id), eq(answers.schoolId, ctx.schoolId)));
    const byItem = new Map(saved.map((s) => [s.itemId, s.response as StoredResponse]));
    items = quizItems.map((item) => toReview(item, byItem.get(item.id), gradeAnswer(item, byItem.get(item.id))));
  }

  const score = !inProgress && attempt.score !== null ? Number(attempt.score) : null;
  const maxScore = attempt.maxScore !== null ? Number(attempt.maxScore) : null;
  return {
    quiz: { id: quizId, title: found.quizTitle, className: found.className },
    student: { id: attempt.studentId, name: found.name, email: found.email },
    attempt: {
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      inProgress,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      timedOut: timedOut(attempt),
      score,
      maxScore,
      percent: score !== null && maxScore !== null ? percentOf(score, maxScore) : null,
    },
    away: (await loadAwayStats(tx, ctx.schoolId, [attempt])).get(attempt.id) ?? UNTRACKED,
    items,
    attempts: siblings.map((a) => ({
      id: a.id,
      attemptNo: a.attemptNo,
      inProgress: a.status === "in_progress",
      score: isFinished(a) && a.score !== null ? Number(a.score) : null,
      maxScore: a.maxScore !== null ? Number(a.maxScore) : null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Deleting a student's result
// ---------------------------------------------------------------------------------------------

/**
 * Permanently deletes every attempt one student has on the quiz, and their answers with them (the
 * answers cascade). It cannot be undone. The student can then start over if the quiz is open and
 * allows it, their attempt numbers begin again at 1, and once a quiz has no attempts left it is
 * no longer frozen. A student who is answering right now loses that attempt too: their next save
 * is refused. The quiz row is locked first, so this cannot interleave with a student starting.
 */
export async function deleteStudentResult(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
  studentId: string,
): Promise<{ attemptsDeleted: number }> {
  if (!isUuid(quizId) || !isUuid(studentId)) {
    throw new ServiceError("Result not found", "not_found");
  }
  return withSchool(db, ctx.schoolId, async (tx) => {
    const [quiz] = await tx
      .select({ id: quizzes.id })
      .from(quizzes)
      .where(
        and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId), isNull(quizzes.archivedAt)),
      )
      .limit(1)
      .for("update");
    if (!quiz) throw new ServiceError("Quiz not found", "not_found");

    const removed = await tx
      .delete(attempts)
      .where(
        and(
          eq(attempts.quizId, quizId),
          eq(attempts.studentId, studentId),
          eq(attempts.schoolId, ctx.schoolId),
        ),
      )
      .returning({ id: attempts.id });
    if (removed.length === 0) {
      throw new ServiceError("This student has no result on this quiz", "not_found");
    }
    return { attemptsDeleted: removed.length };
  });
}
