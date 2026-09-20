import { and, eq, sql } from "drizzle-orm";
import { answers, attempts } from "@/db/schema";
import type { Tx } from "@/db/types";
import { loadQuizItems } from "../quizzes/service";
import { gradeAnswer, type StoredResponse } from "../student/grading";

// Shared by the student side (which ends and grades its own attempts) and the admin results side
// (which ends overdue attempts of a quiz before reporting on it).

type AttemptRef = { id: string; quizId: string };

/**
 * Grades a finished attempt and marks it graded. Runs exactly once per attempt, inside the same
 * transaction that moved it out of in_progress, so a replayed submit cannot score it twice.
 */
export async function gradeAttempt(tx: Tx, schoolId: string, attempt: AttemptRef) {
  const items = await loadQuizItems(tx, schoolId, attempt.quizId);
  const saved = await tx
    .select({ id: answers.id, itemId: answers.quizQuestionId, response: answers.response })
    .from(answers)
    .where(and(eq(answers.attemptId, attempt.id), eq(answers.schoolId, schoolId)));

  let total = 0;
  for (const item of items) {
    const answer = saved.find((s) => s.itemId === item.id);
    const grade = gradeAnswer(item, answer?.response as StoredResponse);
    total += grade.pointsAwarded;
    if (answer) {
      await tx
        .update(answers)
        .set({ isCorrect: grade.isCorrect, pointsAwarded: grade.pointsAwarded.toFixed(2) })
        .where(and(eq(answers.id, answer.id), eq(answers.schoolId, schoolId)));
    }
  }
  await tx
    .update(attempts)
    .set({ status: "graded", score: total.toFixed(2) })
    .where(and(eq(attempts.id, attempt.id), eq(attempts.schoolId, schoolId)));
}

/**
 * Ends an in-progress attempt: `submitted` if it is still inside the deadline plus grace, otherwise
 * `expired`, then grades it. The single guarded UPDATE is what makes this idempotent: a repeat
 * (double click, retry, or the timer and the button racing) matches no row and does nothing.
 * `only.studentId` adds a guard that the attempt belongs to that student. Returns whether this
 * call was the one that ended it.
 */
export async function finishAttempt(
  tx: Tx,
  schoolId: string,
  attempt: AttemptRef,
  only?: { studentId: string },
) {
  const moved = await tx
    .update(attempts)
    .set({
      status: sql`(case when now() <= ${attempts.deadlineAt} + interval '5 seconds'
                        then 'submitted' else 'expired' end)::attempt_status`,
    })
    .where(
      and(
        eq(attempts.id, attempt.id),
        eq(attempts.schoolId, schoolId),
        eq(attempts.status, "in_progress"),
        only ? eq(attempts.studentId, only.studentId) : undefined,
      ),
    )
    .returning({ id: attempts.id });
  if (moved.length === 0) return false;
  await gradeAttempt(tx, schoolId, attempt);
  return true;
}

/**
 * Ends in-progress attempts whose time ran out long ago, for one student and/or one quiz. There is
 * no background worker yet, so this runs whenever someone looks at the attempts; without it an
 * abandoned attempt would stay open forever. The 5 second grace is left alone so an in-flight final
 * save is not cut off.
 */
export async function finishOverdueAttempts(
  tx: Tx,
  schoolId: string,
  scope: { studentId?: string; quizId?: string },
) {
  const overdue = await tx
    .select({ id: attempts.id, quizId: attempts.quizId })
    .from(attempts)
    .where(
      and(
        eq(attempts.schoolId, schoolId),
        eq(attempts.status, "in_progress"),
        sql`${attempts.deadlineAt} + interval '5 seconds' < now()`,
        scope.studentId ? eq(attempts.studentId, scope.studentId) : undefined,
        scope.quizId ? eq(attempts.quizId, scope.quizId) : undefined,
      ),
    );
  for (const attempt of overdue) {
    await finishAttempt(tx, schoolId, attempt, scope.studentId ? { studentId: scope.studentId } : undefined);
  }
}
