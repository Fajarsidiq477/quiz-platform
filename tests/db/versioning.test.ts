import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  createTestDb,
  expectDbError,
  seedPublishedQuestion,
  seedQuiz,
  seedSchool,
  startAttempt,
  type TestDb,
  type World,
} from "./helpers";

const { questionVersions, questionOptions, quizQuestions, quizzes, questions } = schema;

describe("question versioning (rule 3)", () => {
  let db: TestDb;
  let w: World;
  beforeAll(async () => {
    db = await createTestDb();
    w = await seedSchool(db);
  });

  async function draft(type: (typeof questionVersions.$inferInsert)["type"], extra = {}) {
    const [q] = await db
      .insert(questions)
      .values({ schoolId: w.school.id, createdBy: w.teacher.id, topic: "Hardware" })
      .returning();
    const [v] = await db
      .insert(questionVersions)
      .values({
        schoolId: w.school.id,
        questionId: q.id,
        versionNo: 1,
        type,
        prompt: "Prompt",
        createdBy: w.teacher.id,
        ...extra,
      })
      .returning();
    return { q, v };
  }

  const publish = (id: string) =>
    db.update(questionVersions).set({ publishedAt: new Date() }).where(eq(questionVersions.id, id));

  it("rejects an update or delete of a published version", async () => {
    const { version } = await seedPublishedQuestion(db, w);
    await expectDbError(
      db.update(questionVersions).set({ prompt: "Edited" }).where(eq(questionVersions.id, version.id)),
      /published version .* is immutable/,
    );
    await expectDbError(
      db.delete(questionVersions).where(eq(questionVersions.id, version.id)),
      /published version .* is immutable/,
    );
  });

  it("rejects changes to the options of a published version", async () => {
    const { version } = await seedPublishedQuestion(db, w);
    await expectDbError(
      db.update(questionOptions).set({ isCorrect: true }).where(eq(questionOptions.questionVersionId, version.id)),
      /published and immutable/,
    );
    await expectDbError(
      db.insert(questionOptions).values({
        schoolId: w.school.id,
        questionVersionId: version.id,
        position: 3,
        text: "Late option",
      }),
      /published and immutable/,
    );
    await expectDbError(
      db.delete(questionOptions).where(eq(questionOptions.questionVersionId, version.id)),
      /published and immutable/,
    );
  });

  it("lets a new version be added while the old one stays intact", async () => {
    const { question, version } = await seedPublishedQuestion(db, w);
    const [v2] = await db
      .insert(questionVersions)
      .values({
        schoolId: w.school.id,
        questionId: question.id,
        versionNo: 2,
        type: "single_choice",
        prompt: "Reworded prompt",
        createdBy: w.teacher.id,
      })
      .returning();
    expect(v2.versionNo).toBe(2);
    const [old] = await db.select().from(questionVersions).where(eq(questionVersions.id, version.id));
    expect(old.prompt).toBe("Which layer routes packets?");
    // The same version number cannot be reused.
    await expectDbError(
      db.insert(questionVersions).values({
        schoolId: w.school.id,
        questionId: question.id,
        versionNo: 2,
        type: "single_choice",
        prompt: "Duplicate",
        createdBy: w.teacher.id,
      }),
      /question_versions_question_version_uq/,
    );
  });

  it("refuses to insert a version that is already published", async () => {
    const [q] = await db
      .insert(questions)
      .values({ schoolId: w.school.id, createdBy: w.teacher.id, topic: "x" })
      .returning();
    await expectDbError(
      db.insert(questionVersions).values({
        schoolId: w.school.id,
        questionId: q.id,
        versionNo: 1,
        type: "short_answer",
        prompt: "p",
        acceptedAnswers: ["a"],
        publishedAt: new Date(),
        createdBy: w.teacher.id,
      }),
      /insert as a draft/,
    );
  });

  it("validates content at publish time", async () => {
    // single_choice: exactly one correct option.
    const single = await draft("single_choice");
    await db.insert(questionOptions).values([
      { schoolId: w.school.id, questionVersionId: single.v.id, position: 1, text: "a", isCorrect: true },
      { schoolId: w.school.id, questionVersionId: single.v.id, position: 2, text: "b", isCorrect: true },
    ]);
    await expectDbError(publish(single.v.id), /needs exactly 1 correct option/);

    // choice question with fewer than two options.
    const lonely = await draft("single_choice");
    await db.insert(questionOptions).values({
      schoolId: w.school.id,
      questionVersionId: lonely.v.id,
      position: 1,
      text: "only",
      isCorrect: true,
    });
    await expectDbError(publish(lonely.v.id), /at least 2 options/);

    // multiple_choice: at least one correct option.
    const multi = await draft("multiple_choice");
    await db.insert(questionOptions).values([
      { schoolId: w.school.id, questionVersionId: multi.v.id, position: 1, text: "a" },
      { schoolId: w.school.id, questionVersionId: multi.v.id, position: 2, text: "b" },
    ]);
    await expectDbError(publish(multi.v.id), /at least 1 correct option/);

    // short_answer: needs accepted answers, and no options.
    const short = await draft("short_answer");
    await expectDbError(publish(short.v.id), /non-empty accepted_answers/);
    await db.update(questionVersions).set({ acceptedAnswers: ["router"] }).where(eq(questionVersions.id, short.v.id));
    await publish(short.v.id);
  });

  it("only allows accepted_answers on short_answer questions", async () => {
    await expectDbError(draft("single_choice", { acceptedAnswers: ["x"] }), /question_versions_accepted_answers_ck/);
  });

  it("pins only published versions to a quiz", async () => {
    const { quiz } = await seedQuiz(db, w, { questionCount: 0 });
    const { v } = await draft("short_answer", { acceptedAnswers: ["a"] });
    await expectDbError(
      db.insert(quizQuestions).values({
        schoolId: w.school.id,
        quizId: quiz.id,
        questionVersionId: v.id,
        position: 1,
        points: "1",
      }),
      /only published question versions/,
    );
  });

  it("freezes a quiz's items and settings once an attempt exists", async () => {
    const { quiz, items } = await seedQuiz(db, w);
    const { version } = await seedPublishedQuestion(db, w);
    await startAttempt(db, w, quiz.id);

    await expectDbError(
      db.insert(quizQuestions).values({
        schoolId: w.school.id,
        quizId: quiz.id,
        questionVersionId: version.id,
        position: 2,
        points: "1",
      }),
      /items are frozen/,
    );
    await expectDbError(
      db.delete(quizQuestions).where(eq(quizQuestions.id, items[0].id)),
      /items are frozen/,
    );
    await expectDbError(
      db.update(quizzes).set({ timeLimitSeconds: 9999 }).where(eq(quizzes.id, quiz.id)),
      /frozen once attempts exist/,
    );
    await expectDbError(
      db.update(quizzes).set({ status: "draft" }).where(eq(quizzes.id, quiz.id)),
      /cannot go back to draft/,
    );
    // Closing the quiz is still allowed.
    await db.update(quizzes).set({ status: "closed" }).where(eq(quizzes.id, quiz.id));
  });

  it("does not let a quiz leave draft without a window", async () => {
    await expectDbError(
      db.insert(quizzes).values({
        schoolId: w.school.id,
        classId: w.cls.id,
        createdBy: w.teacher.id,
        title: "No window",
        status: "published",
      }),
      /quizzes_published_has_window_ck/,
    );
  });
});
