import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { HELP_SHEET, QUESTIONS_SHEET, TEMPLATE_FILE_NAME, TYPE_LABELS, XLSX_CONTENT_TYPE, columnRoleOf, questionTypeOf } from "@/features/quiz-import/format";
import { parseQuizWorkbook } from "@/features/quiz-import/parse";
import { buildTemplate } from "@/features/quiz-import/template";

async function load() {
  const bytes = await buildTemplate();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return { bytes, workbook };
}

describe("the example workbook", () => {
  it("is a real .xlsx file", async () => {
    const bytes = await buildTemplate();
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // "PK": a zip container
    expect(TEMPLATE_FILE_NAME).toBe("quiz-import-template.xlsx");
    expect(XLSX_CONTENT_TYPE).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("imports as it is: the four examples are valid questions, one of each type", async () => {
    const { bytes } = await load();
    const result = await parseQuizWorkbook(new Uint8Array(bytes));
    expect(result.errors).toEqual([]);
    expect(result.questions.map((q) => q.type)).toEqual(["single_choice", "multiple_choice", "true_false", "short_answer"]);
    expect(result.questions.map((q) => q.points)).toEqual([2, 3, 1, 1]);

    const [single, multiple, tf, short] = result.questions;
    expect(single.type === "single_choice" && single.options.map((o) => o.isCorrect)).toEqual([false, true, false, false]);
    expect(multiple.type === "multiple_choice" && multiple.options.map((o) => o.isCorrect)).toEqual([true, false, true, true]);
    expect(tf).toMatchObject({ correct: true });
    expect(short).toMatchObject({ acceptedAnswers: ["Domain Name System", "Domain Name Service"] });
  });

  it("has a Questions sheet with the headers the reader looks for, first", async () => {
    const { workbook } = await load();
    expect(workbook.worksheets.map((s) => s.name)).toEqual([QUESTIONS_SHEET, HELP_SHEET]);
    const headers: string[] = [];
    workbook.getWorksheet(QUESTIONS_SHEET)!.getRow(1).eachCell((cell) => headers.push(cell.text));
    expect(headers).toEqual(["Type", "Question", "Points", "Option A", "Option B", "Option C", "Option D", "Option E", "Option F", "Correct answer", "Explanation"]);
    for (const header of headers) expect(columnRoleOf(header), header).not.toBeNull();
  });

  it("offers the question types in a dropdown, and only sensible points", async () => {
    const { workbook } = await load();
    const sheet = workbook.getWorksheet(QUESTIONS_SHEET)!;
    const typeCell = sheet.getCell("A2").dataValidation;
    expect(typeCell.type).toBe("list");
    const offered = String(typeCell.formulae?.[0]).replaceAll('"', "").split(",");
    expect(offered).toEqual(Object.values(TYPE_LABELS));
    for (const label of offered) expect(questionTypeOf(label), label).not.toBeNull();
    expect(sheet.getCell("A150").dataValidation.type).toBe("list"); // also on the empty rows below
    expect(sheet.getCell("C2").dataValidation.type).toBe("decimal");
  });

  it("keeps Excel from reinterpreting answer cells, and freezes the header row", async () => {
    const { workbook } = await load();
    const sheet = workbook.getWorksheet(QUESTIONS_SHEET)!;
    expect(sheet.getCell("J2").numFmt).toBe("@"); // Correct answer
    expect(sheet.getCell("D40").numFmt).toBe("@"); // an option cell on an empty row
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("explains itself on a second sheet", async () => {
    const { workbook } = await load();
    const text: string[] = [];
    workbook.getWorksheet(HELP_SHEET)!.eachRow((row) => text.push(row.values ? (row.values as unknown[]).join(" ") : ""));
    const all = text.join("\n");
    for (const phrase of ["Single choice", "Multiple choice", "True/False", "Short answer", "at most 100 questions", ".xlsx"]) {
      expect(all, phrase).toContain(phrase);
    }
  });
});

describe("column and type names", () => {
  it("understands the names a teacher might type", () => {
    expect(questionTypeOf("Single Choice")).toBe("single_choice");
    expect(questionTypeOf("TRUE / FALSE")).toBe("true_false");
    expect(questionTypeOf("essay")).toBeNull();
    expect(columnRoleOf(" Correct  answer ")).toEqual({ kind: "correct" });
    expect(columnRoleOf("Option c")).toEqual({ kind: "option", index: 2 });
    expect(columnRoleOf("Option K")).toBeNull(); // only A to J
    expect(columnRoleOf("Notes")).toBeNull();
  });
});
