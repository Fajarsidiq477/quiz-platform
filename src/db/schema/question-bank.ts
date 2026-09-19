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
import { createdAt, pk, schoolId, tstz } from "./_columns";
import { questionType } from "./enums";
import { users } from "./people";

/** Stable identity of a question. Content lives in `question_versions`; this row is never edited. */
export const questions = pgTable(
  "questions",
  {
    id: pk(),
    schoolId: schoolId(),
    createdBy: uuid("created_by").notNull(),
    topic: text("topic").notNull(),
    archivedAt: tstz("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "questions_created_by_fk",
      columns: [t.createdBy, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    unique("questions_id_school_uq").on(t.id, t.schoolId),
    index("questions_school_topic_idx")
      .on(t.schoolId, t.topic)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * Immutable content. Insert as a draft (`published_at` null), add options, then publish by setting
 * `published_at`. A DB trigger validates the content at publish time and rejects any later
 * UPDATE/DELETE. To change a question, insert version_no + 1.
 */
export const questionVersions = pgTable(
  "question_versions",
  {
    id: pk(),
    schoolId: schoolId(),
    questionId: uuid("question_id").notNull(),
    versionNo: integer("version_no").notNull(),
    type: questionType("type").notNull(),
    prompt: text("prompt").notNull(),
    defaultPoints: numeric("default_points", { precision: 6, scale: 2 }).notNull().default("1"),
    /** Only for `short_answer`: a non-empty JSON array of accepted strings. */
    acceptedAnswers: jsonb("accepted_answers").$type<string[]>(),
    explanation: text("explanation"),
    publishedAt: tstz("published_at"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "question_versions_question_fk",
      columns: [t.questionId, t.schoolId],
      foreignColumns: [questions.id, questions.schoolId],
    }).onDelete("restrict"),
    foreignKey({
      name: "question_versions_created_by_fk",
      columns: [t.createdBy, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    // Doubles as the "latest version of a question" index.
    uniqueIndex("question_versions_question_version_uq").on(t.questionId, t.versionNo.desc()),
    unique("question_versions_id_school_uq").on(t.id, t.schoolId),
    check("question_versions_version_no_ck", sql`${t.versionNo} >= 1`),
    check("question_versions_points_ck", sql`${t.defaultPoints} >= 0`),
    check(
      "question_versions_accepted_answers_ck",
      sql`${t.acceptedAnswers} is null or ${t.type} = 'short_answer'`,
    ),
  ],
);

/** Choices for the choice-based types. Frozen together with their version. */
export const questionOptions = pgTable(
  "question_options",
  {
    id: pk(),
    schoolId: schoolId(),
    questionVersionId: uuid("question_version_id").notNull(),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    isCorrect: boolean("is_correct").notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: "question_options_version_fk",
      columns: [t.questionVersionId, t.schoolId],
      foreignColumns: [questionVersions.id, questionVersions.schoolId],
    }).onDelete("restrict"),
    unique("question_options_version_position_uq").on(t.questionVersionId, t.position),
    unique("question_options_id_school_uq").on(t.id, t.schoolId),
    check("question_options_position_ck", sql`${t.position} >= 1`),
  ],
);
