import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { pk, schoolId, tstz } from "./_columns";
import { attemptStatus } from "./enums";
import { users } from "./people";
import { quizQuestions, quizzes } from "./quizzes";

/** Shape of `answers.response`. Validated at the boundary by `answerResponseSchema` (Zod). */
export type AnswerResponse = { optionIds: string[] } | { text: string };

/**
 * Timing is server-only (CLAUDE.md rule 1). A BEFORE INSERT trigger overwrites `started_at` and
 * `deadline_at` from the database clock and the quiz settings, so whatever the caller passes for
 * them is ignored; `started_at`/`deadline_at` are immutable afterwards.
 */
export const attempts = pgTable(
  "attempts",
  {
    id: pk(),
    schoolId: schoolId(),
    quizId: uuid("quiz_id").notNull(),
    studentId: uuid("student_id").notNull(),
    attemptNo: integer("attempt_no").notNull().default(1),
    status: attemptStatus("status").notNull().default("in_progress"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    // Defaulted only so inserts type-check; the trigger computes the real value.
    deadlineAt: tstz("deadline_at").notNull().default(sql`now()`),
    submittedAt: tstz("submitted_at"),
    score: numeric("score", { precision: 8, scale: 2 }),
    maxScore: numeric("max_score", { precision: 8, scale: 2 }),
    gradedAt: tstz("graded_at"),
    // True for attempts started while time away from the quiz page was being recorded. Older
    // attempts have no records because nothing was recorded, which is not the same as "never left".
    awayTracked: boolean("away_tracked").notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: "attempts_quiz_fk",
      columns: [t.quizId, t.schoolId],
      foreignColumns: [quizzes.id, quizzes.schoolId],
    }).onDelete("restrict"),
    foreignKey({
      name: "attempts_student_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    unique("attempts_quiz_student_no_uq").on(t.quizId, t.studentId, t.attemptNo),
    // At most one open attempt per student per quiz: a duplicate "start" hits this index.
    uniqueIndex("attempts_one_open_uq")
      .on(t.quizId, t.studentId)
      .where(sql`${t.status} = 'in_progress'`),
    unique("attempts_id_school_uq").on(t.id, t.schoolId),
    // Referenced by answers so an answer can only point at an attempt of the same quiz.
    unique("attempts_id_quiz_school_uq").on(t.id, t.quizId, t.schoolId),
    // The expiry sweeper (BullMQ backup) finds overdue attempts cheaply.
    index("attempts_open_deadline_idx")
      .on(t.deadlineAt)
      .where(sql`${t.status} = 'in_progress'`),
    index("attempts_quiz_status_idx").on(t.quizId, t.status),
    index("attempts_student_started_idx").on(t.studentId, t.startedAt.desc()),
    check("attempts_attempt_no_ck", sql`${t.attemptNo} >= 1`),
    check("attempts_deadline_ck", sql`${t.deadlineAt} > ${t.startedAt}`),
    check(
      "attempts_submitted_ck",
      sql`${t.submittedAt} is null or ${t.submittedAt} >= ${t.startedAt}`,
    ),
  ],
);

export const answers = pgTable(
  "answers",
  {
    id: pk(),
    schoolId: schoolId(),
    attemptId: uuid("attempt_id").notNull(),
    // Denormalised so two composite FKs prove the item belongs to the attempt's own quiz.
    quizId: uuid("quiz_id").notNull(),
    quizQuestionId: uuid("quiz_question_id").notNull(),
    response: jsonb("response").$type<AnswerResponse>().notNull(),
    isCorrect: boolean("is_correct"),
    pointsAwarded: numeric("points_awarded", { precision: 6, scale: 2 }),
    gradedBy: uuid("graded_by"),
    feedback: text("feedback"),
    answeredAt: tstz("answered_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "answers_attempt_fk",
      columns: [t.attemptId, t.quizId, t.schoolId],
      foreignColumns: [attempts.id, attempts.quizId, attempts.schoolId],
    }).onDelete("cascade"),
    foreignKey({
      name: "answers_quiz_question_fk",
      columns: [t.quizQuestionId, t.quizId, t.schoolId],
      foreignColumns: [quizQuestions.id, quizQuestions.quizId, quizQuestions.schoolId],
    }).onDelete("restrict"),
    // Null graded_by skips this FK (MATCH SIMPLE), which is intended for auto-graded answers.
    foreignKey({
      name: "answers_graded_by_fk",
      columns: [t.gradedBy, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    // Idempotency: saving the same answer twice converges on one row (INSERT ... ON CONFLICT).
    unique("answers_attempt_question_uq").on(t.attemptId, t.quizQuestionId),
    unique("answers_id_school_uq").on(t.id, t.schoolId),
    index("answers_quiz_question_idx").on(t.quizQuestionId),
    // Manual-grading queue.
    index("answers_ungraded_idx")
      .on(t.attemptId)
      .where(sql`${t.isCorrect} is null`),
    check("answers_points_ck", sql`${t.pointsAwarded} is null or ${t.pointsAwarded} >= 0`),
  ],
);

export const AWAY_REASONS = ["hidden", "blur", "fullscreen"] as const;
export type AwayReason = (typeof AWAY_REASONS)[number];

/**
 * Every stretch of time a student spent away from the quiz page during an attempt: the tab was
 * hidden or minimised (`hidden`), another window had focus (`blur`), or they left full screen
 * (`fullscreen`). The browser only says "I left" and "I am back"; the database stamps both moments
 * with its own clock (a trigger overwrites `started_at` and sets `ended_at`), so a student cannot
 * shorten a period by sending a different time. A period that never ends (the tab was closed) has a
 * null `ended_at`; readers cap it at the moment the attempt ended. One open period per attempt
 * makes a repeated "I left" a no-op.
 */
export const attemptAwayPeriods = pgTable(
  "attempt_away_periods",
  {
    id: pk(),
    schoolId: schoolId(),
    attemptId: uuid("attempt_id").notNull(),
    reason: text("reason").$type<AwayReason>().notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
  },
  (t) => [
    // Deleting a student's result deletes these with the attempt.
    foreignKey({
      name: "attempt_away_attempt_fk",
      columns: [t.attemptId, t.schoolId],
      foreignColumns: [attempts.id, attempts.schoolId],
    }).onDelete("cascade"),
    unique("attempt_away_id_school_uq").on(t.id, t.schoolId),
    uniqueIndex("attempt_away_one_open_uq")
      .on(t.attemptId)
      .where(sql`${t.endedAt} is null`),
    index("attempt_away_attempt_idx").on(t.attemptId, t.startedAt),
    check("attempt_away_reason_ck", sql`${t.reason} in ('hidden', 'blur', 'fullscreen')`),
    check("attempt_away_ended_ck", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);
