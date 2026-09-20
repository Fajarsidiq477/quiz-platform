import ExcelJS from "exceljs";
import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { ServiceError, type Ctx } from "@/features/errors";
import { parseImportSettings } from "@/features/quiz-import/schemas";
import { importQuizFromExcel } from "@/features/quiz-import/service";
import { buildTemplate } from "@/features/quiz-import/template";
import type { QuizInput } from "@/features/quizzes/schemas";
import { getQuiz, listQuizzes, publishQuiz, updateQuiz } from "@/features/quizzes/service";
import { asAppRole, createAppRole, createTestDb, seedSchool, type TestDb, type World } from "../db/helpers";

const HOUR = 3_600_000;
const CLASS_ID = "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b";

describe("import settings", () => {
  const settings = (over: Partial<{ title: string; classId: string; timeLimitMinutes: string }> = {}) =>
    parseImportSettings({ title: "Chapter 4", classId: CLASS_ID, timeLimitMinutes: "30", ...over });

  it("starts an imported quiz as a new quiz would, with no dates", () => {
    const parsed = settings();
    expect(parsed.success && parsed.data).toMatchObject({
      title: "Chapter 4",
      classId: CLASS_ID,
      timeLimitMinutes: 30,
      opensAt: null,
      closesAt: null,
      maxAttempts: 1,
      shuffleQuestions: false,
      resultsVisibility: "after_close",
    });
  });

  it("uses the same rules and messages as the New quiz form", () => {
    const messages = (r: ReturnType<typeof settings>) => (r.success ? [] : r.error.issues.map((i) => i.message));
    expect(messages(settings({ title: "  " }))).toEqual(["Title is required"]);
    expect(messages(settings({ classId: "" }))).toEqual(["Choose a class"]);
    expect(messages(settings({ timeLimitMinutes: "0" }))).toEqual(["At least 1 minute"]);
    expect(messages(settings({ timeLimitMinutes: "601" }))).toEqual(["At most 600 minutes"]);
    const untimed = settings({ timeLimitMinutes: "" });
    expect(untimed.success && untimed.data.timeLimitMinutes).toBeNull();
  });
});

describe("importing a quiz from Excel", () => {
  let db: TestDb;
  let w: World;
  let admin: Ctx;
  let template: Uint8Array; // the downloadable example, which is a valid quiz as it stands
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
    admin = { schoolId: w.school.id, userId: w.teacher.id };
    template = new Uint8Array(await buildTemplate());
  });

  const settings = (over: Partial<QuizInput> = {}): QuizInput => {
    const parsed = parseImportSettings({ title: "Imported quiz", classId: w.cls.id, timeLimitMinutes: "45" });
    if (!parsed.success) throw new Error("bad test settings");
    return { ...parsed.data, ...over };
  };
  const counts = async () => ({
    quizzes: (await db.select({ n: count() }).from(schema.quizzes))[0].n,
    questions: (await db.select({ n: count() }).from(schema.questions))[0].n,
    versions: (await db.select({ n: count() }).from(schema.questionVersions))[0].n,
    items: (await db.select({ n: count() }).from(schema.quizQuestions))[0].n,
  });

  it("creates a draft quiz with every question, in the order of the rows", async () => {
    const result = await as(() => importQuizFromExcel(db, admin, settings(), template));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questionCount).toBe(4);

    const detail = (await as(() => getQuiz(db, admin.schoolId, result.id)))!;
    expect(detail.quiz).toMatchObject({
      title: "Imported quiz",
      status: "draft",
      classId: w.cls.id,
      timeLimitSeconds: 45 * 60,
      opensAt: null,
      closesAt: null,
      maxAttempts: 1,
      createdBy: w.teacher.id,
    });
    expect(detail.items.map((i) => [i.position, i.type, Number(i.points)])).toEqual([
      [1, "single_choice", 2],
      [2, "multiple_choice", 3],
      [3, "true_false", 1],
      [4, "short_answer", 1],
    ]);
    expect(detail.items[0].prompt).toBe("Which layer of the OSI model routes packets between networks?");
    expect(detail.items[0].options.map((o) => [o.text, o.isCorrect])).toEqual([
      ["Data link", false],
      ["Network", true],
      ["Transport", false],
      ["Session", false],
    ]);
    expect(detail.items[3].acceptedAnswers).toEqual(["Domain Name System", "Domain Name Service"]);
    expect(detail.items[0].explanation).toBe("Routers work at the Network layer (layer 3).");
  });

  it("makes real, versioned questions like the form does, all in this school", async () => {
    const before = await counts();
    const result = await as(() => importQuizFromExcel(db, admin, settings({ title: "Second" }), template));
    expect(result.ok).toBe(true);

    const after = await counts();
    expect(after.quizzes - before.quizzes).toBe(1);
    expect(after.questions - before.questions).toBe(4);
    expect(after.versions - before.versions).toBe(4);
    expect(after.items - before.items).toBe(4);

    const versions = await db.select().from(schema.questionVersions);
    expect(versions.every((v) => v.versionNo === 1 && v.publishedAt !== null && v.schoolId === w.school.id)).toBe(true);
    const bank = await db.select().from(schema.questions);
    expect(bank.every((q) => q.schoolId === w.school.id && q.createdBy === w.teacher.id)).toBe(true);
    expect(bank.some((q) => q.topic === "Second")).toBe(true);
  });

  it("can then be given its dates and published like any draft", async () => {
    const result = await as(() => importQuizFromExcel(db, admin, settings({ title: "To publish" }), template));
    if (!result.ok) throw new Error("import failed");

    await expect(as(() => publishQuiz(db, admin, result.id))).rejects.toThrow(/opening and closing time/);
    await as(() =>
      updateQuiz(db, admin, result.id, {
        ...settings({ title: "To publish" }),
        opensAt: new Date(Date.now() - HOUR),
        closesAt: new Date(Date.now() + 24 * HOUR),
      }),
    );
    await as(() => publishQuiz(db, admin, result.id));
    expect((await as(() => getQuiz(db, admin.schoolId, result.id)))!.quiz.status).toBe("published");
  });

  it("creates nothing when the file has a problem, and lists the rows to fix", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Questions");
    sheet.addRow(["Type", "Question", "Points", "Option A", "Option B", "Correct answer"]);
    sheet.addRow(["Single choice", "Fine?", 1, "x", "y", "A"]);
    sheet.addRow(["Single choice", "Broken?", 1, "x", "y", "Z"]);
    sheet.addRow(["Essay", "Also broken?", 1, "x", "y", "A"]);
    const file = new Uint8Array(await workbook.xlsx.writeBuffer());

    const before = await counts();
    const result = await as(() => importQuizFromExcel(db, admin, settings({ title: "Never made" }), file));
    expect(result).toEqual({
      ok: false,
      errors: [
        'Row 3, Correct answer: "Z" is not an option letter. Write letters like B, or A, C.',
        'Row 4, Type: "Essay" is not a question type. Use Single choice, Multiple choice, True/False or Short answer.',
      ],
    });
    expect(await counts()).toEqual(before);
    expect((await as(() => listQuizzes(db, admin.schoolId))).some((q) => q.title === "Never made")).toBe(false);
  });

  it("creates nothing from a file that is not a workbook", async () => {
    const before = await counts();
    const result = await as(() => importQuizFromExcel(db, admin, settings(), new TextEncoder().encode("a,b\n1,2")));
    expect(result.ok).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("refuses a class from another school, and leaves no trace", async () => {
    const other = await seedSchool(db);
    const before = await counts();

    const error = await as(() => importQuizFromExcel(db, admin, settings({ classId: other.cls.id }), template)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).message).toBe("Choose a class");
    expect(await counts()).toEqual(before);
  });

  it("puts the quiz in the importer's school only", async () => {
    const other = await seedSchool(db);
    const octx = { schoolId: other.school.id, userId: other.teacher.id };
    const result = await as(() =>
      importQuizFromExcel(db, octx, settings({ classId: other.cls.id, title: "Other school" }), template),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await as(() => getQuiz(db, admin.schoolId, result.id))).toBeNull(); // not visible to the first school
    const [row] = await db.select().from(schema.quizzes).where(eq(schema.quizzes.id, result.id));
    expect(row.schoolId).toBe(other.school.id);
  });
});

