// The Excel layout for importing a quiz. The template and the reader both use these names, so they
// cannot drift apart.

export const QUESTIONS_SHEET = "Questions";
export const HELP_SHEET = "How to fill in";
export const TEMPLATE_FILE_NAME = "quiz-import-template.xlsx";
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A quiz file is a few kilobytes; this leaves room for a long quiz with formatting. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Up to ten options, as in the question form. The template shows the first six. */
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"] as const;
export const TEMPLATE_OPTION_COUNT = 6;

export const HEADERS = {
  type: "Type",
  question: "Question",
  points: "Points",
  correct: "Correct answer",
  explanation: "Explanation",
} as const;
export const optionHeader = (letter: string) => `Option ${letter}`;

/** What the Type column shows and accepts (in a dropdown in the template). */
export const TYPE_LABELS = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  true_false: "True/False",
  short_answer: "Short answer",
} as const;

/** "Single choice", "single_choice" and "SINGLE-CHOICE" all mean the same thing. */
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

const TYPE_ALIASES: Record<string, keyof typeof TYPE_LABELS> = {
  singlechoice: "single_choice",
  single: "single_choice",
  multiplechoice: "multiple_choice",
  multiple: "multiple_choice",
  multi: "multiple_choice",
  truefalse: "true_false",
  tf: "true_false",
  shortanswer: "short_answer",
  short: "short_answer",
};

export function questionTypeOf(text: string): keyof typeof TYPE_LABELS | null {
  return TYPE_ALIASES[squash(text)] ?? null;
}

/** Column headers a teacher might write, mapped to what they mean. Order and case do not matter. */
const HEADER_ALIASES: Record<string, "type" | "question" | "points" | "correct" | "explanation"> = {
  type: "type",
  questiontype: "type",
  question: "question",
  questiontext: "question",
  prompt: "question",
  points: "points",
  point: "points",
  score: "points",
  marks: "points",
  correctanswer: "correct",
  correctanswers: "correct",
  correct: "correct",
  answer: "correct",
  answers: "correct",
  explanation: "explanation",
  feedback: "explanation",
};

export type ColumnRole =
  | { kind: "type" | "question" | "points" | "correct" | "explanation" }
  | { kind: "option"; index: number };

export function columnRoleOf(header: string): ColumnRole | null {
  const key = squash(header);
  const plain = HEADER_ALIASES[key];
  if (plain) return { kind: plain };
  const option = /^option([a-j])$/.exec(key);
  if (option) return { kind: "option", index: option[1].charCodeAt(0) - "a".charCodeAt(0) };
  return null;
}
