import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseQuizWorkbook } from "@/features/quiz-import/parse";

type Cell = string | number | boolean | null;
const HEADER: Cell[] = ["Type", "Question", "Points", "Option A", "Option B", "Option C", "Option D", "Correct answer", "Explanation"];

/** A workbook with the given rows (row 1 is the first array), as the bytes of an .xlsx file. */
async function book(rows: Cell[][], sheetName = "Questions"): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
const parse = async (...rows: Cell[][]) => parseQuizWorkbook(await book([HEADER, ...rows]));

describe("reading questions", () => {
  it("reads a single choice question", async () => {
    const r = await parse(["Single choice", "Which layer routes packets?", 2, "Data link", "Network", "Transport", null, "B", "Layer 3."]);
    expect(r.errors).toEqual([]);
    expect(r.questions).toEqual([
      {
        type: "single_choice",
        prompt: "Which layer routes packets?",
        points: 2,
        explanation: "Layer 3.",
        options: [
          { text: "Data link", isCorrect: false },
          { text: "Network", isCorrect: true },
          { text: "Transport", isCorrect: false },
        ],
      },
    ]);
  });

  it("reads several correct letters, however they are written", async () => {
    for (const correct of ["A, C", "a,c", "A and C", "A;C", "A C", "1, 3", " a , c "]) {
      const r = await parse(["Multiple choice", "Q?", 1, "one", "two", "three", null, correct, null]);
      expect(r.errors, correct).toEqual([]);
      const q = r.questions[0];
      expect(q.type === "multiple_choice" && q.options.map((o) => o.isCorrect), correct).toEqual([true, false, true]);
    }
  });

  it("reads True/False in its usual spellings, and a real TRUE cell", async () => {
    for (const [cell, expected] of [["True", true], ["false", false], ["T", true], ["F", false], ["Benar", true], ["Salah", false], [true, true], [false, false]] as const) {
      const r = await parse(["True/False", "Sky is blue.", null, null, null, null, null, cell, null]);
      expect(r.errors, String(cell)).toEqual([]);
      expect(r.questions[0]).toMatchObject({ type: "true_false", correct: expected });
    }
  });

  it("splits short answers on | and on new lines, and drops repeats", async () => {
    const r = await parse(["Short answer", "DNS stands for?", null, null, null, null, null, "Domain Name System | domain name service\nDNS\nDomain Name System", null]);
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toMatchObject({
      type: "short_answer",
      acceptedAnswers: ["Domain Name System", "domain name service", "DNS"],
    });
  });

  it("gives a question 1 point when Points is empty, and reads decimals", async () => {
    const r = await parse(
      ["Single choice", "A?", null, "x", "y", null, null, "A", null],
      ["Single choice", "B?", 2.5, "x", "y", null, null, "A", null],
      ["Single choice", "C?", "3", "x", "y", null, null, "A", null],
    );
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.points)).toEqual([1, 2.5, 3]);
  });

  it("accepts type names in other spellings", async () => {
    const r = await parse(
      ["single_choice", "A?", 1, "x", "y", null, null, "A", null],
      ["SINGLE CHOICE", "B?", 1, "x", "y", null, null, "B", null],
      ["Multiple", "C?", 1, "x", "y", null, null, "A,B", null],
      ["tf", "D?", 1, null, null, null, null, "true", null],
      ["Short", "E?", 1, null, null, null, null, "yes", null],
    );
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.type)).toEqual(["single_choice", "single_choice", "multiple_choice", "true_false", "short_answer"]);
  });

  it("finds columns by name in any order, in any case, and ignores columns it does not know", async () => {
    const r = await parseQuizWorkbook(
      await book([
        ["My notes", "answer", "OPTION B", "option a", "prompt", "question type", "marks"],
        ["please review", "A", "Network", "Data link", "Which layer routes?", "Single choice", 4],
      ]),
    );
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toMatchObject({
      type: "single_choice",
      prompt: "Which layer routes?",
      points: 4,
      options: [{ text: "Data link", isCorrect: true }, { text: "Network", isCorrect: false }],
    });
  });

  it("skips empty rows, and numbers problems by the row in Excel", async () => {
    const r = await parse(
      ["Single choice", "Good?", 1, "x", "y", null, null, "A", null],
      [null, null, null, null, null, null, null, null, null],
      ["Single choice", "", 1, "x", "y", null, null, "A", null],
    );
    expect(r.errors).toEqual(["Row 4, Question: Write the question"]);
  });

  it("reads numbers, rich text and formula results in cells as text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Questions");
    sheet.addRow(HEADER);
    sheet.addRow(["Single choice", null, 1, 42, "b", null, null, "A", null]);
    sheet.getCell("B2").value = { richText: [{ text: "Bold " }, { text: "question" }] };
    sheet.getCell("E2").value = { formula: '"b"&""', result: "b" };
    const r = await parseQuizWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toMatchObject({
      prompt: "Bold question",
      options: [{ text: "42", isCorrect: true }, { text: "b", isCorrect: false }],
    });
  });

  it("prefers the Questions sheet, otherwise the first sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const notes = workbook.addWorksheet("Notes");
    notes.addRow(["nothing useful here"]);
    const real = workbook.addWorksheet("Questions");
    real.addRow(HEADER);
    real.addRow(["True/False", "Yes?", 1, null, null, null, null, "True", null]);
    expect((await parseQuizWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()))).questions).toHaveLength(1);

    const first = await parseQuizWorkbook(await book([HEADER, ["True/False", "Yes?", 1, null, null, null, null, "True", null]], "Sheet1"));
    expect(first.questions).toHaveLength(1);
  });
});

describe("problems in the questions", () => {
  const one = async (row: Cell[]) => (await parse(row)).errors;

  it("names the type problems", async () => {
    expect(await one(["Essay", "Q?", 1, "x", "y", null, null, "A", null])).toEqual([
      'Row 2, Type: "Essay" is not a question type. Use Single choice, Multiple choice, True/False or Short answer.',
    ]);
    expect((await one([null, "Q?", 1, "x", "y", null, null, "A", null]))[0]).toMatch(/^Row 2, Type: choose a type/);
  });

  it("explains a missing or wrong correct answer", async () => {
    expect((await one(["Single choice", "Q?", 1, "x", "y", null, null, null, null]))[0]).toMatch(/Row 2, Correct answer: write the correct option letter/);
    expect(await one(["Single choice", "Q?", 1, "x", "y", null, null, "Z", null])).toEqual(['Row 2, Correct answer: "Z" is not an option letter. Write letters like B, or A, C.']);
    expect(await one(["Single choice", "Q?", 1, "x", "y", null, null, "C", null])).toEqual(["Row 2, Correct answer: option C is marked correct but it is empty."]);
    expect(await one(["True/False", "Q?", 1, null, null, null, null, "maybe", null])).toEqual(['Row 2, Correct answer: "maybe" is not True or False.']);
    expect((await one(["True/False", "Q?", 1, null, null, null, null, null, null]))[0]).toMatch(/write True or False/);
  });

  it("uses the same rules as the question form", async () => {
    // Two right answers for a single choice question.
    expect(await one(["Single choice", "Q?", 1, "x", "y", null, null, "A, B", null])).toEqual(["Row 2, Correct answer: Mark exactly one correct option"]);
    // A choice question needs at least two options.
    expect(await one(["Single choice", "Q?", 1, "only", null, null, null, "A", null])).toEqual(["Row 2, Correct answer: Add at least 2 options"]);
    // A short answer needs an accepted answer.
    expect(await one(["Short answer", "Q?", 1, null, null, null, null, null, null])).toEqual(["Row 2, Correct answer: List at least one accepted answer"]);
    // Points.
    expect(await one(["True/False", "Q?", "lots", null, null, null, null, "True", null])).toEqual(["Row 2, Points: Enter the points"]);
    expect(await one(["True/False", "Q?", -1, null, null, null, null, "True", null])).toEqual(["Row 2, Points: Points cannot be negative"]);
    // Length limits, with the column named.
    expect(await one(["Single choice", "Q?", 1, "x".repeat(501), "y", null, null, "A", null])).toEqual(["Row 2, Option A: Use at most 500 characters"]);
  });

  it("refuses a gap between options, because letters would shift", async () => {
    expect(await one(["Single choice", "Q?", 1, "x", null, "z", null, "A", null])).toEqual([
      "Row 2: Option B is empty but a later option is filled in. Fill options in order.",
    ]);
    expect((await one(["Single choice", "Q?", 1, null, null, null, null, "A", null]))[0]).toMatch(/Row 2, Option A: give the options/);
  });

  it("reports every problem at once and creates no question from a file with any", async () => {
    const r = await parse(
      ["Single choice", "Fine?", 1, "x", "y", null, null, "A", null],
      ["Essay", "Bad type?", 1, null, null, null, null, "A", null],
      ["True/False", "Bad answer?", 1, null, null, null, null, "perhaps", null],
      ["Short answer", "Fine too?", 1, null, null, null, null, "yes", null],
    );
    expect(r.questions).toEqual([]);
    expect(r.errors.map((e) => e.slice(0, 5))).toEqual(["Row 3", "Row 4"]);
  });

  it("stops listing after 50 problems", async () => {
    const rows = Array.from({ length: 60 }, (): Cell[] => ["Nope", "Q?", 1, "x", "y", null, null, "A", null]);
    const r = await parse(...rows);
    expect(r.errors).toHaveLength(51);
    expect(r.errors[50]).toBe("…and 10 more. Fix these first, then upload again.");
  });
});

describe("problems with the file", () => {
  it("refuses more than 100 questions", async () => {
    const rows = Array.from({ length: 101 }, (_, i): Cell[] => ["True/False", `Q${i}?`, 1, null, null, null, null, "True", null]);
    expect((await parse(...rows)).errors).toEqual(["A quiz can have at most 100 questions, and this file has 101."]);
    const ok = Array.from({ length: 100 }, (_, i): Cell[] => ["True/False", `Q${i}?`, 1, null, null, null, null, "True", null]);
    expect((await parse(...ok)).questions).toHaveLength(100);
  });

  it("needs the Type, Question and Correct answer columns", async () => {
    const r = await parseQuizWorkbook(await book([["Question", "Points"], ["Q?", 1]]));
    expect(r.errors).toEqual(["The first row must have these columns: Type, Correct answer. Download the example file to see the format."]);
  });

  it("refuses a column that appears twice", async () => {
    const r = await parseQuizWorkbook(await book([["Type", "Question", "Correct answer", "Answer"], ["Short answer", "Q?", "a", "b"]]));
    expect(r.errors[0]).toMatch(/appears more than once/);
  });

  it("says when there is nothing to import", async () => {
    expect((await parseQuizWorkbook(await book([HEADER]))).errors).toEqual(["No questions found. Fill in one question per row under the header row."]);
    expect((await parseQuizWorkbook(await book([]))).errors[0]).toMatch(/must have these columns/);
  });

  it("gives clear messages for a file that is not an .xlsx", async () => {
    const csv = new TextEncoder().encode("Type,Question\nTrue/False,Q?");
    expect((await parseQuizWorkbook(csv)).errors[0]).toMatch(/not an Excel \.xlsx file/);
    expect((await parseQuizWorkbook(new Uint8Array())).errors[0]).toMatch(/not an Excel \.xlsx file/);
    // Looks like a zip (starts with PK) but is not a workbook.
    const notBook = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await parseQuizWorkbook(notBook)).errors[0]).toMatch(/could not be read/);
  });
});
