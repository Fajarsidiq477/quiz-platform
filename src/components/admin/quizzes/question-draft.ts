import type { QuestionType } from "@/features/quizzes/schemas";

/** What the question form holds while the teacher is typing (strings, not yet validated). */
export type QuestionDraft = {
  type: QuestionType;
  prompt: string;
  points: string;
  explanation: string;
  options: { text: string; isCorrect: boolean }[];
  trueFalseCorrect: boolean;
  /** One accepted answer per line. */
  acceptedAnswers: string;
};

export const MAX_OPTIONS = 10;
export const MIN_OPTIONS = 2;

export const blankOptions = () => [
  { text: "", isCorrect: true },
  { text: "", isCorrect: false },
];

export function emptyDraft(): QuestionDraft {
  return {
    type: "single_choice",
    prompt: "",
    points: "1",
    explanation: "",
    options: blankOptions(),
    trueFalseCorrect: true,
    acceptedAnswers: "",
  };
}

/** Builds a draft from a stored quiz item so it can be edited. */
export function draftFromItem(item: {
  type: QuestionType;
  prompt: string;
  points: string;
  explanation: string | null;
  acceptedAnswers: string[] | null;
  options: { text: string; isCorrect: boolean }[];
}): QuestionDraft {
  const choice = item.type === "single_choice" || item.type === "multiple_choice";
  return {
    type: item.type,
    prompt: item.prompt,
    points: String(Number(item.points)), // "2.00" -> "2"
    explanation: item.explanation ?? "",
    options: choice
      ? item.options.map(({ text, isCorrect }) => ({ text, isCorrect }))
      : blankOptions(),
    // True is stored as the first option.
    trueFalseCorrect: item.type === "true_false" ? (item.options[0]?.isCorrect ?? true) : true,
    acceptedAnswers: (item.acceptedAnswers ?? []).join("\n"),
  };
}

/** Switching to single choice keeps only the first correct option (or marks the first). */
export function withType(draft: QuestionDraft, type: QuestionType): QuestionDraft {
  if (type !== "single_choice") return { ...draft, type };
  const firstCorrect = draft.options.findIndex((o) => o.isCorrect);
  const keep = firstCorrect === -1 ? 0 : firstCorrect;
  return { ...draft, type, options: draft.options.map((o, i) => ({ ...o, isCorrect: i === keep })) };
}

/** Marks one option as the only correct one (single choice). */
export function selectOnly(draft: QuestionDraft, index: number): QuestionDraft {
  return { ...draft, options: draft.options.map((o, i) => ({ ...o, isCorrect: i === index })) };
}

export function toggleCorrect(draft: QuestionDraft, index: number): QuestionDraft {
  return {
    ...draft,
    options: draft.options.map((o, i) => (i === index ? { ...o, isCorrect: !o.isCorrect } : o)),
  };
}

export function addOption(draft: QuestionDraft): QuestionDraft {
  if (draft.options.length >= MAX_OPTIONS) return draft;
  return { ...draft, options: [...draft.options, { text: "", isCorrect: false }] };
}

/** Removing the correct option of a single-choice question leaves the first one marked correct. */
export function removeOption(draft: QuestionDraft, index: number): QuestionDraft {
  if (draft.options.length <= MIN_OPTIONS) return draft;
  const next = { ...draft, options: draft.options.filter((_, i) => i !== index) };
  return draft.type === "single_choice" && !next.options.some((o) => o.isCorrect)
    ? selectOnly(next, 0)
    : next;
}

/** The JSON sent to the server, which validates it again with the Zod schema. */
export function buildPayload(draft: QuestionDraft) {
  const base = {
    type: draft.type,
    prompt: draft.prompt,
    points: draft.points,
    explanation: draft.explanation,
  };
  switch (draft.type) {
    case "single_choice":
    case "multiple_choice":
      return { ...base, options: draft.options };
    case "true_false":
      return { ...base, correct: draft.trueFalseCorrect };
    case "short_answer":
      return {
        ...base,
        acceptedAnswers: draft.acceptedAnswers
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      };
  }
}
