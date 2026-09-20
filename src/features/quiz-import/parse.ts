import ExcelJS from "exceljs";
import { questionInputSchema, type QuestionInput } from "../quizzes/schemas";
import { MAX_QUESTIONS_PER_QUIZ } from "../quizzes/service";
import { OPTION_LETTERS, QUESTIONS_SHEET, columnRoleOf, questionTypeOf, type ColumnRole } from "./format";

export type ParseResult = {
  questions: QuestionInput[];
  /** Everything wrong with the file, in plain words. Empty when the file is fine. */
  errors: string[];
};

const MAX_REPORTED = 50;
const letter = (index: number) => OPTION_LETTERS[index] ?? String(index + 1);

const TRUE_WORDS = new Set(["true", "t", "yes", "y", "1", "benar"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "0", "salah"]);

/** Columns of the first row, by what they mean. */
type Columns = {
  type?: number;
  question?: number;
  points?: number;
  correct?: number;
  explanation?: number;
  options: Map<number, number>; // option index (A = 0) -> column
};

/**
 * "B" -> [1], "A, C" -> [0, 2], "2" -> [1]. A letter is an option; a number is its position.
 * Returns the first thing that is neither.
 */
function optionIndexes(text: string): { indexes: number[] } | { bad: string } {
  const indexes = new Set<number>();
  for (const token of text.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
    if (/^and$/i.test(token)) continue;
    if (/^[A-Ja-j]$/.test(token)) indexes.add(token.toUpperCase().charCodeAt(0) - 65);
    else if (/^([1-9]|10)$/.test(token)) indexes.add(Number(token) - 1);
    else return { bad: token };
  }
  return { indexes: [...indexes].sort((a, b) => a - b) };
}

/** Where a Zod problem belongs, as the teacher sees it: the column in the sheet. */
function columnOf(path: PropertyKey[]): string | null {
  const [first, second] = path;
  if (first === "prompt") return "Question";
  if (first === "points") return "Points";
  if (first === "explanation") return "Explanation";
  if (first === "acceptedAnswers" || first === "correct") return "Correct answer";
  if (first === "options") return typeof second === "number" ? `Option ${letter(second)}` : "Correct answer";
  return null;
}

/**
 * Reads a quiz from an Excel workbook: the "Questions" sheet (or the first sheet), headers in the
 * first row, one question per row. Every row goes through the same rules as a question typed into
 * the form (`questionInputSchema`). Nothing is partly accepted: if there is any problem the result
 * lists all of them (up to 50) and the caller creates nothing.
 */
export async function parseQuizWorkbook(bytes: Uint8Array): Promise<ParseResult> {
  const fail = (message: string): ParseResult => ({ questions: [], errors: [message] });

  // A .xlsx is a zip file. Checking first gives an .xls, a .csv or a renamed file a clear message.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return fail("This is not an Excel .xlsx file. In Excel, use File > Save As > Excel Workbook (.xlsx).");
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return fail("This file could not be read as an Excel workbook. Open it in Excel and save it again as .xlsx.");
  }
  const sheet = workbook.getWorksheet(QUESTIONS_SHEET) ?? workbook.worksheets[0];
  if (!sheet) return fail("The workbook has no sheets.");

  // ---- header row
  const columns: Columns = { options: new Map() };
  const errors: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const role: ColumnRole | null = columnRoleOf(cell.text);
    if (!role) return; // a note column of the teacher's own is fine
    if (role.kind === "option") {
      if (columns.options.has(role.index)) errors.push(`The column "${cell.text.trim()}" appears more than once in the first row.`);
      else columns.options.set(role.index, col);
    } else if (columns[role.kind] !== undefined) {
      errors.push(`The column "${cell.text.trim()}" appears more than once in the first row.`);
    } else {
      columns[role.kind] = col;
    }
  });
  const missing = (["type", "question", "correct"] as const)
    .filter((role) => columns[role] === undefined)
    .map((role) => ({ type: "Type", question: "Question", correct: "Correct answer" })[role]);
  if (missing.length > 0) {
    return fail(
      `The first row must have these columns: ${missing.join(", ")}. Download the example file to see the format.`,
    );
  }
  if (errors.length > 0) return { questions: [], errors };

  const cellText = (row: ExcelJS.Row, col: number | undefined) =>
    col === undefined ? "" : row.getCell(col).text.trim();

  // ---- question rows
  const questions: QuestionInput[] = [];
  let filledRows = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const typeText = cellText(row, columns.type);
    const prompt = cellText(row, columns.question);
    const correct = cellText(row, columns.correct);
    const optionTexts = [...columns.options.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, col]) => ({ index, text: cellText(row, col) }));
    const explanation = cellText(row, columns.explanation);
    const pointsCell = columns.points === undefined ? undefined : row.getCell(columns.points);
    const points = pointsCell && typeof pointsCell.value === "number" ? pointsCell.value : (pointsCell?.text.trim() ?? "");

    // A row with nothing in it (formatting only) is skipped, not an error.
    if (!typeText && !prompt && !correct && !explanation && points === "" && optionTexts.every((o) => !o.text)) return;

    filledRows += 1;
    if (filledRows > MAX_QUESTIONS_PER_QUIZ) return; // reported once, below
    const problem = (message: string, column?: string) =>
      errors.push(column ? `Row ${rowNumber}, ${column}: ${message}` : `Row ${rowNumber}: ${message}`);

    if (!typeText) return problem("choose a type: Single choice, Multiple choice, True/False or Short answer.", "Type");
    const type = questionTypeOf(typeText);
    if (!type) {
      return problem(`"${typeText}" is not a question type. Use Single choice, Multiple choice, True/False or Short answer.`, "Type");
    }

    let raw: Record<string, unknown>;
    if (type === "single_choice" || type === "multiple_choice") {
      // Options run A, B, C...; a gap would shift which letter means what, so it is refused.
      const last = optionTexts.reduce((max, o) => (o.text ? o.index : max), -1);
      const listed = optionTexts.filter((o) => o.index <= last);
      const gap = listed.find((o) => !o.text);
      const skipped = [...Array(last + 1).keys()].find((i) => !listed.some((o) => o.index === i));
      if (gap || skipped !== undefined) {
        const at = gap?.index ?? skipped!;
        return problem(`Option ${letter(at)} is empty but a later option is filled in. Fill options in order.`);
      }
      if (last < 0) return problem("give the options in the Option A, Option B... columns.", "Option A");
      if (!correct) return problem("write the correct option letter, for example B (or A, C for several).", "Correct answer");

      const picked = optionIndexes(correct);
      if ("bad" in picked) {
        return problem(`"${picked.bad}" is not an option letter. Write letters like B, or A, C.`, "Correct answer");
      }
      const beyond = picked.indexes.find((i) => i > last);
      if (beyond !== undefined) {
        return problem(`option ${letter(beyond)} is marked correct but it is empty.`, "Correct answer");
      }
      raw = {
        type,
        prompt,
        points,
        explanation,
        options: listed.map((o) => ({ text: o.text, isCorrect: picked.indexes.includes(o.index) })),
      };
    } else if (type === "true_false") {
      const word = correct.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!TRUE_WORDS.has(word) && !FALSE_WORDS.has(word)) {
        return problem(correct ? `"${correct}" is not True or False.` : "write True or False.", "Correct answer");
      }
      raw = { type, prompt, points, explanation, correct: TRUE_WORDS.has(word) };
    } else {
      raw = {
        type,
        prompt,
        points,
        explanation,
        acceptedAnswers: correct.split(/\r?\n|\|/).map((a) => a.trim()).filter(Boolean),
      };
    }

    const parsed = questionInputSchema.safeParse(raw);
    if (parsed.success) {
      questions.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues) problem(issue.message, columnOf(issue.path) ?? undefined);
  });

  if (filledRows > MAX_QUESTIONS_PER_QUIZ) {
    errors.push(`A quiz can have at most ${MAX_QUESTIONS_PER_QUIZ} questions, and this file has ${filledRows}.`);
  }
  if (filledRows === 0) {
    return fail("No questions found. Fill in one question per row under the header row.");
  }
  if (errors.length > MAX_REPORTED) {
    const more = errors.length - MAX_REPORTED;
    return { questions: [], errors: [...errors.slice(0, MAX_REPORTED), `…and ${more} more. Fix these first, then upload again.`] };
  }
  return { questions: errors.length > 0 ? [] : questions, errors };
}
