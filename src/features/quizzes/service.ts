import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  attempts,
  classes,
  questionOptions,
  questions,
  questionVersions,
  quizQuestions,
  quizzes,
} from "@/db/schema";
import { withSchool } from "@/db/tenant";
import type { AnyPgDb, Tx } from "@/db/types";
import { ServiceError, type Ctx } from "../errors";
import { sameQuestion, toVersionContent, type VersionContent } from "./content";
import type { QuestionInput, QuestionType, QuizInput } from "./schemas";

export const MAX_QUESTIONS_PER_QUIZ = 100;

export type QuizRow = typeof quizzes.$inferSelect;

export type QuizSummary = {
  id: string;
  title: string;
  status: QuizRow["status"];
  classId: string;
  className: string;
  opensAt: Date | null;
  closesAt: Date | null;
  questionCount: number;
};

export type QuizItem = {
  /** The `quiz_questions` row id (not the question id). */
  id: string;
  position: number;
  points: string;
  questionId: string;
  versionId: string;
  versionNo: number;
  type: QuestionType;
  prompt: string;
  explanation: string | null;
  acceptedAnswers: string[] | null;
  options: { id: string; position: number; text: string; isCorrect: boolean }[];
};

export type QuizDetail = {
  quiz: QuizRow;
  className: string;
  attemptCount: number;
  items: QuizItem[];
};

const isUuid = (v: string) => z.uuid().safeParse(v).success;

function assertUuid(id: string, message: string) {
  if (!isUuid(id)) throw new ServiceError(message, "not_found");
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

export async function listQuizzes(db: AnyPgDb, schoolId: string): Promise<QuizSummary[]> {
  return withSchool(db, schoolId, (tx) =>
    tx
      .select({
        id: quizzes.id,
        title: quizzes.title,
        status: quizzes.status,
        classId: quizzes.classId,
        className: classes.name,
        opensAt: quizzes.opensAt,
        closesAt: quizzes.closesAt,
        // Written out in full for the same reason as the class list: never rely on Drizzle
        // qualifying a column inside a raw subquery.
        questionCount: sql<number>`(select count(*)::int from quiz_questions qq
          where qq.quiz_id = "quizzes"."id")`,
      })
      .from(quizzes)
      .innerJoin(
        classes,
        and(eq(classes.id, quizzes.classId), eq(classes.schoolId, quizzes.schoolId)),
      )
      .where(and(eq(quizzes.schoolId, schoolId), isNull(quizzes.archivedAt)))
      .orderBy(desc(quizzes.createdAt)),
  );
}

/** The quiz's questions in order, with their options (including which are correct). */
export async function loadQuizItems(tx: Tx, schoolId: string, quizId: string): Promise<QuizItem[]> {
  return loadItems(tx, schoolId, quizId);
}

async function loadItems(tx: Tx, schoolId: string, quizId: string): Promise<QuizItem[]> {
  const rows = await tx
    .select({
      id: quizQuestions.id,
      position: quizQuestions.position,
      points: quizQuestions.points,
      questionId: questionVersions.questionId,
      versionId: questionVersions.id,
      versionNo: questionVersions.versionNo,
      type: questionVersions.type,
      prompt: questionVersions.prompt,
      explanation: questionVersions.explanation,
      acceptedAnswers: questionVersions.acceptedAnswers,
    })
    .from(quizQuestions)
    .innerJoin(questionVersions, eq(questionVersions.id, quizQuestions.questionVersionId))
    .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.schoolId, schoolId)))
    .orderBy(asc(quizQuestions.position));
  if (rows.length === 0) return [];

  const optionRows = await tx
    .select({
      id: questionOptions.id,
      versionId: questionOptions.questionVersionId,
      position: questionOptions.position,
      text: questionOptions.text,
      isCorrect: questionOptions.isCorrect,
    })
    .from(questionOptions)
    .where(
      and(
        inArray(
          questionOptions.questionVersionId,
          rows.map((r) => r.versionId),
        ),
        eq(questionOptions.schoolId, schoolId),
      ),
    )
    .orderBy(asc(questionOptions.position));

  return rows.map((row) => ({
    ...row,
    options: optionRows
      .filter((o) => o.versionId === row.versionId)
      .map(({ id, position, text, isCorrect }) => ({ id, position, text, isCorrect })),
  }));
}

async function countAttempts(tx: Tx, schoolId: string, quizId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(attempts)
    .where(and(eq(attempts.quizId, quizId), eq(attempts.schoolId, schoolId)));
  return row.n;
}

export async function getQuiz(
  db: AnyPgDb,
  schoolId: string,
  quizId: string,
): Promise<QuizDetail | null> {
  if (!isUuid(quizId)) return null;
  return withSchool(db, schoolId, async (tx) => {
    const [row] = await tx
      .select({ quiz: quizzes, className: classes.name })
      .from(quizzes)
      .innerJoin(
        classes,
        and(eq(classes.id, quizzes.classId), eq(classes.schoolId, quizzes.schoolId)),
      )
      .where(
        and(eq(quizzes.id, quizId), eq(quizzes.schoolId, schoolId), isNull(quizzes.archivedAt)),
      )
      .limit(1);
    if (!row) return null;
    return {
      quiz: row.quiz,
      className: row.className,
      attemptCount: await countAttempts(tx, schoolId, quizId),
      items: await loadItems(tx, schoolId, quizId),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers for writing
// ---------------------------------------------------------------------------------------------

/** Loads the quiz and locks the row, so concurrent edits of one quiz are serialised. */
async function lockQuiz(tx: Tx, ctx: Ctx, quizId: string): Promise<QuizRow> {
  const [quiz] = await tx
    .select()
    .from(quizzes)
    .where(
      and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId), isNull(quizzes.archivedAt)),
    )
    .limit(1)
    .for("update");
  if (!quiz) throw new ServiceError("Quiz not found", "not_found");
  return quiz;
}

function assertDraft(quiz: QuizRow) {
  if (quiz.status !== "draft") {
    throw new ServiceError(
      "Only a draft quiz can be edited. Unpublish it first.",
      "invalid_state",
    );
  }
}

async function assertClass(tx: Tx, schoolId: string, classId: string) {
  const [row] = await tx
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.schoolId, schoolId), isNull(classes.archivedAt)))
    .limit(1);
  if (!row) throw new ServiceError("Choose a class", "invalid_input");
}

function settingsValues(input: QuizInput) {
  return {
    classId: input.classId,
    title: input.title,
    description: input.description,
    timeLimitSeconds: input.timeLimitMinutes === null ? null : input.timeLimitMinutes * 60,
    opensAt: input.opensAt,
    closesAt: input.closesAt,
    maxAttempts: input.maxAttempts,
    shuffleQuestions: input.shuffleQuestions,
    resultsVisibility: input.resultsVisibility,
  };
}

// ---------------------------------------------------------------------------------------------
// Quiz lifecycle: create, edit, publish, unpublish, close, delete
// ---------------------------------------------------------------------------------------------

export async function createQuiz(db: AnyPgDb, ctx: Ctx, input: QuizInput): Promise<{ id: string }> {
  return withSchool(db, ctx.schoolId, async (tx) => {
    await assertClass(tx, ctx.schoolId, input.classId);
    const [row] = await tx
      .insert(quizzes)
      .values({
        schoolId: ctx.schoolId,
        createdBy: ctx.userId,
        status: "draft",
        ...settingsValues(input),
      })
      .returning({ id: quizzes.id });
    return row;
  });
}

export async function updateQuiz(db: AnyPgDb, ctx: Ctx, quizId: string, input: QuizInput) {
  assertUuid(quizId, "Quiz not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    assertDraft(await lockQuiz(tx, ctx, quizId));
    await assertClass(tx, ctx.schoolId, input.classId);
    await tx
      .update(quizzes)
      .set(settingsValues(input))
      .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)));
  });
}

export async function publishQuiz(db: AnyPgDb, ctx: Ctx, quizId: string) {
  assertUuid(quizId, "Quiz not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    const quiz = await lockQuiz(tx, ctx, quizId);
    if (quiz.status !== "draft") {
      throw new ServiceError("This quiz is already published", "invalid_state");
    }
    if (!quiz.opensAt || !quiz.closesAt) {
      throw new ServiceError("Set the opening and closing time before publishing");
    }
    if (quiz.closesAt.getTime() <= Date.now()) {
      throw new ServiceError("The closing time has already passed. Choose a later time.");
    }
    const items = await loadItems(tx, ctx.schoolId, quizId);
    if (items.length === 0) {
      throw new ServiceError("Add at least one question before publishing");
    }
    await tx
      .update(quizzes)
      .set({ status: "published" })
      .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)));
  });
}

/** Back to draft so it can be edited again. Refused once any student has started it. */
export async function unpublishQuiz(db: AnyPgDb, ctx: Ctx, quizId: string) {
  assertUuid(quizId, "Quiz not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    const quiz = await lockQuiz(tx, ctx, quizId);
    if (quiz.status !== "published") {
      throw new ServiceError("Only a published quiz can be unpublished", "invalid_state");
    }
    if ((await countAttempts(tx, ctx.schoolId, quizId)) > 0) {
      throw new ServiceError(
        "Students have already started this quiz, so it can no longer be edited",
        "invalid_state",
      );
    }
    await tx
      .update(quizzes)
      .set({ status: "draft" })
      .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)));
  });
}

export async function closeQuiz(db: AnyPgDb, ctx: Ctx, quizId: string) {
  assertUuid(quizId, "Quiz not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    const quiz = await lockQuiz(tx, ctx, quizId);
    if (quiz.status !== "published") {
      throw new ServiceError("Only a published quiz can be closed", "invalid_state");
    }
    await tx
      .update(quizzes)
      .set({ status: "closed" })
      .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)));
  });
}

/**
 * Removes a quiz nobody has attempted. A quiz with attempts is archived instead (hidden, closed,
 * results kept), because students' attempts and answers must never be lost. The questions stay in
 * the question bank either way.
 */
export async function deleteQuiz(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
): Promise<"deleted" | "archived"> {
  assertUuid(quizId, "Quiz not found");
  return withSchool(db, ctx.schoolId, async (tx) => {
    await lockQuiz(tx, ctx, quizId);
    if ((await countAttempts(tx, ctx.schoolId, quizId)) > 0) {
      await tx
        .update(quizzes)
        .set({ status: "closed", archivedAt: sql`now()` })
        .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)));
      return "archived";
    }
    await tx
      .delete(quizQuestions)
      .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.schoolId, ctx.schoolId)));
    await tx
      .delete(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.schoolId, ctx.schoolId)));
    return "deleted";
  });
}

// ---------------------------------------------------------------------------------------------
// Questions inside a quiz
// ---------------------------------------------------------------------------------------------

/** Inserts a draft version with its options, then publishes it (the database validates it). */
async function insertPublishedVersion(
  tx: Tx,
  ctx: Ctx,
  questionId: string,
  versionNo: number,
  content: VersionContent,
): Promise<string> {
  const [version] = await tx
    .insert(questionVersions)
    .values({
      schoolId: ctx.schoolId,
      questionId,
      versionNo,
      type: content.type,
      prompt: content.prompt,
      defaultPoints: content.points,
      acceptedAnswers: content.acceptedAnswers,
      explanation: content.explanation,
      createdBy: ctx.userId,
    })
    .returning({ id: questionVersions.id });

  if (content.options.length > 0) {
    await tx.insert(questionOptions).values(
      content.options.map((option, index) => ({
        schoolId: ctx.schoolId,
        questionVersionId: version.id,
        position: index + 1,
        text: option.text,
        isCorrect: option.isCorrect,
      })),
    );
  }
  await tx
    .update(questionVersions)
    .set({ publishedAt: sql`now()` })
    .where(and(eq(questionVersions.id, version.id), eq(questionVersions.schoolId, ctx.schoolId)));
  return version.id;
}

function contentOf(item: QuizItem): VersionContent {
  return {
    type: item.type,
    prompt: item.prompt,
    explanation: item.explanation,
    points: item.points,
    acceptedAnswers: item.acceptedAnswers,
    options: item.options.map(({ text, isCorrect }) => ({ text, isCorrect })),
  };
}

/** Creates a new question (version 1) and adds it to the end of the quiz. */
export async function addQuestion(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
  input: QuestionInput,
): Promise<{ id: string }> {
  assertUuid(quizId, "Quiz not found");
  return withSchool(db, ctx.schoolId, async (tx) => {
    const quiz = await lockQuiz(tx, ctx, quizId);
    assertDraft(quiz);

    const [{ count, last }] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        last: sql<number>`coalesce(max(${quizQuestions.position}), 0)::int`,
      })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.schoolId, ctx.schoolId)));
    if (count >= MAX_QUESTIONS_PER_QUIZ) {
      throw new ServiceError(`A quiz can have at most ${MAX_QUESTIONS_PER_QUIZ} questions`);
    }

    const content = toVersionContent(input);
    const [question] = await tx
      .insert(questions)
      .values({ schoolId: ctx.schoolId, createdBy: ctx.userId, topic: quiz.title.slice(0, 100) })
      .returning({ id: questions.id });
    const versionId = await insertPublishedVersion(tx, ctx, question.id, 1, content);

    const [item] = await tx
      .insert(quizQuestions)
      .values({
        schoolId: ctx.schoolId,
        quizId,
        questionVersionId: versionId,
        position: last + 1,
        points: content.points,
      })
      .returning({ id: quizQuestions.id });
    return item;
  });
}

/**
 * Edits a question in a draft quiz. Published versions are immutable, so a real content change
 * creates version n+1 and points the quiz at it; the old version stays exactly as it was. Changing
 * only the points needs no new version.
 */
export async function updateQuestion(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
  itemId: string,
  input: QuestionInput,
) {
  assertUuid(quizId, "Quiz not found");
  assertUuid(itemId, "Question not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    assertDraft(await lockQuiz(tx, ctx, quizId));
    const item = (await loadItems(tx, ctx.schoolId, quizId)).find((i) => i.id === itemId);
    if (!item) throw new ServiceError("Question not found", "not_found");

    const next = toVersionContent(input);
    let versionId = item.versionId;
    if (!sameQuestion(contentOf(item), next)) {
      const [{ latest }] = await tx
        .select({ latest: sql<number>`max(${questionVersions.versionNo})::int` })
        .from(questionVersions)
        .where(
          and(
            eq(questionVersions.questionId, item.questionId),
            eq(questionVersions.schoolId, ctx.schoolId),
          ),
        );
      versionId = await insertPublishedVersion(tx, ctx, item.questionId, latest + 1, next);
    }
    await tx
      .update(quizQuestions)
      .set({ questionVersionId: versionId, points: next.points })
      .where(and(eq(quizQuestions.id, itemId), eq(quizQuestions.schoolId, ctx.schoolId)));
  });
}

/** Takes a question out of the quiz. The question itself stays in the question bank. */
export async function removeQuestion(db: AnyPgDb, ctx: Ctx, quizId: string, itemId: string) {
  assertUuid(quizId, "Quiz not found");
  assertUuid(itemId, "Question not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    assertDraft(await lockQuiz(tx, ctx, quizId));
    const removed = await tx
      .delete(quizQuestions)
      .where(
        and(
          eq(quizQuestions.id, itemId),
          eq(quizQuestions.quizId, quizId),
          eq(quizQuestions.schoolId, ctx.schoolId),
        ),
      )
      .returning({ id: quizQuestions.id });
    if (removed.length === 0) throw new ServiceError("Question not found", "not_found");
  });
}

/**
 * Swaps a question with its neighbour. `(quiz_id, position)` is unique and not deferrable, so the
 * swap goes through a temporary position instead of two direct updates.
 */
export async function moveQuestion(
  db: AnyPgDb,
  ctx: Ctx,
  quizId: string,
  itemId: string,
  direction: "up" | "down",
) {
  assertUuid(quizId, "Quiz not found");
  assertUuid(itemId, "Question not found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    assertDraft(await lockQuiz(tx, ctx, quizId));
    const rows = await tx
      .select({ id: quizQuestions.id, position: quizQuestions.position })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.quizId, quizId), eq(quizQuestions.schoolId, ctx.schoolId)))
      .orderBy(asc(quizQuestions.position));

    const index = rows.findIndex((r) => r.id === itemId);
    if (index === -1) throw new ServiceError("Question not found", "not_found");
    const neighbour = rows[direction === "up" ? index - 1 : index + 1];
    if (!neighbour) return; // already first or last: nothing to do

    const current = rows[index];
    const temporary = rows[rows.length - 1].position + 1;
    const setPosition = (id: string, position: number) =>
      tx
        .update(quizQuestions)
        .set({ position })
        .where(and(eq(quizQuestions.id, id), eq(quizQuestions.schoolId, ctx.schoolId)));

    await setPosition(current.id, temporary);
    await setPosition(neighbour.id, current.position);
    await setPosition(current.id, neighbour.position);
  });
}
