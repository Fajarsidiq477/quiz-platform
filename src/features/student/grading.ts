import type { QuestionType } from "../quizzes/schemas";

/** What a student has saved for one question. Empty means "cleared", which counts as unanswered. */
export type StoredResponse = { optionIds?: string[]; text?: string } | null | undefined;

export type GradableItem = {
  type: QuestionType;
  points: string | number;
  options: { id: string; isCorrect: boolean }[];
  acceptedAnswers: string[] | null;
};

/** Case, extra spaces and full-width characters do not make a short answer wrong. */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isAnswered(item: Pick<GradableItem, "type">, response: StoredResponse): boolean {
  if (!response) return false;
  if (item.type === "short_answer") return normalizeText(response.text ?? "") !== "";
  return (response.optionIds ?? []).length > 0;
}

/**
 * Automatic grading. All-or-nothing: a multiple-choice question is right only if exactly the
 * correct options are selected, and a wrong or missing answer earns 0 (no negative marking).
 */
export function isAnswerCorrect(item: GradableItem, response: StoredResponse): boolean {
  if (!isAnswered(item, response)) return false;

  if (item.type === "short_answer") {
    const given = normalizeText(response?.text ?? "");
    return (item.acceptedAnswers ?? []).some((accepted) => normalizeText(accepted) === given);
  }

  const selected = new Set(response?.optionIds ?? []);
  const correct = new Set(item.options.filter((o) => o.isCorrect).map((o) => o.id));
  return selected.size === correct.size && [...selected].every((id) => correct.has(id));
}

export function gradeAnswer(item: GradableItem, response: StoredResponse) {
  const isCorrect = isAnswerCorrect(item, response);
  return { isCorrect, pointsAwarded: isCorrect ? Number(item.points) : 0 };
}

/**
 * Whether a student may see their score and the answers, following the quiz's setting:
 * `after_submit` at once, `after_close` once the quiz is closed (by the teacher or by its closing
 * time), `never` not at all.
 */
export function canSeeResults(
  visibility: "never" | "after_submit" | "after_close",
  quiz: { status: "draft" | "published" | "closed"; closesAt: Date | null },
  nowMs: number,
): boolean {
  switch (visibility) {
    case "after_submit":
      return true;
    case "after_close":
      return quiz.status === "closed" || (quiz.closesAt !== null && nowMs >= quiz.closesAt.getTime());
    case "never":
      return false;
  }
}

function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A shuffle that is the same every time for the same seed (the attempt id), so refreshing the page
 * mid-quiz does not reorder the questions.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  let state = hashSeed(seed);
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
