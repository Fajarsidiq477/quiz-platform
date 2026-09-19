import type { QuestionInput, QuestionType } from "./schemas";

/**
 * The stored shape of one question version: what `question_versions` and `question_options`
 * hold, and the unit compared to decide whether an edit needs a new version.
 */
export type VersionContent = {
  type: QuestionType;
  prompt: string;
  explanation: string | null;
  /** Numeric string with two decimals, as Postgres stores it (e.g. "2.00"). */
  points: string;
  acceptedAnswers: string[] | null;
  options: { text: string; isCorrect: boolean }[];
};

export function toVersionContent(input: QuestionInput): VersionContent {
  const base = {
    type: input.type,
    prompt: input.prompt,
    explanation: input.explanation,
    points: input.points.toFixed(2),
  };
  switch (input.type) {
    case "single_choice":
    case "multiple_choice":
      return { ...base, acceptedAnswers: null, options: input.options };
    case "true_false":
      return {
        ...base,
        acceptedAnswers: null,
        options: [
          { text: "True", isCorrect: input.correct },
          { text: "False", isCorrect: !input.correct },
        ],
      };
    case "short_answer":
      return { ...base, acceptedAnswers: input.acceptedAnswers, options: [] };
  }
}

/** True when two versions would show the same question (points are not part of the content). */
export function sameQuestion(a: VersionContent, b: VersionContent): boolean {
  const key = (c: VersionContent) =>
    JSON.stringify([c.type, c.prompt, c.explanation ?? null, c.acceptedAnswers, c.options]);
  return key(a) === key(b);
}
