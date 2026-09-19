import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, schoolId, tstz } from "./_columns";
import { quizStatus, resultsVisibility } from "./enums";
import { classes, users } from "./people";
import { questionVersions } from "./question-bank";

export const quizzes = pgTable(
  "quizzes",
  {
    id: pk(),
    schoolId: schoolId(),
    classId: uuid("class_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: quizStatus("status").notNull().default("draft"),
    /** Null = untimed (the attempt is then bounded only by `closes_at`). */
    timeLimitSeconds: integer("time_limit_seconds"),
    opensAt: tstz("opens_at"),
    closesAt: tstz("closes_at"),
    maxAttempts: integer("max_attempts").notNull().default(1),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(false),
    resultsVisibility: resultsVisibility("results_visibility").notNull().default("after_close"),
    archivedAt: tstz("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "quizzes_class_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),
    foreignKey({
      name: "quizzes_created_by_fk",
      columns: [t.createdBy, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    unique("quizzes_id_school_uq").on(t.id, t.schoolId),
    index("quizzes_class_status_opens_idx").on(t.classId, t.status, t.opensAt),
    check(
      "quizzes_window_ck",
      sql`${t.opensAt} is null or ${t.closesAt} is null or ${t.opensAt} < ${t.closesAt}`,
    ),
    // A quiz can only leave draft once it has a window, because attempts need a hard end time.
    check(
      "quizzes_published_has_window_ck",
      sql`${t.status} = 'draft' or (${t.opensAt} is not null and ${t.closesAt} is not null)`,
    ),
    check("quizzes_time_limit_ck", sql`${t.timeLimitSeconds} is null or ${t.timeLimitSeconds} > 0`),
    check("quizzes_max_attempts_ck", sql`${t.maxAttempts} >= 1`),
  ],
);

/**
 * Pins a specific published question *version* to a quiz, so a published quiz never changes under
 * students. Frozen (by trigger) once any attempt exists.
 *
 * Reordering: `(quiz_id, position)` is a plain unique constraint, so swap positions in two steps
 * (move to a temporary offset, then to the final value) instead of one UPDATE.
 */
export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: pk(),
    schoolId: schoolId(),
    quizId: uuid("quiz_id").notNull(),
    questionVersionId: uuid("question_version_id").notNull(),
    position: integer("position").notNull(),
    points: numeric("points", { precision: 6, scale: 2 }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "quiz_questions_quiz_fk",
      columns: [t.quizId, t.schoolId],
      foreignColumns: [quizzes.id, quizzes.schoolId],
    }).onDelete("restrict"),
    foreignKey({
      name: "quiz_questions_version_fk",
      columns: [t.questionVersionId, t.schoolId],
      foreignColumns: [questionVersions.id, questionVersions.schoolId],
    }).onDelete("restrict"),
    unique("quiz_questions_quiz_position_uq").on(t.quizId, t.position),
    unique("quiz_questions_quiz_version_uq").on(t.quizId, t.questionVersionId),
    unique("quiz_questions_id_school_uq").on(t.id, t.schoolId),
    // Referenced by answers so an answer can only point at an item of its own attempt's quiz.
    unique("quiz_questions_id_quiz_school_uq").on(t.id, t.quizId, t.schoolId),
    index("quiz_questions_version_idx").on(t.questionVersionId),
    check("quiz_questions_position_ck", sql`${t.position} >= 1`),
    check("quiz_questions_points_ck", sql`${t.points} >= 0`),
  ],
);
