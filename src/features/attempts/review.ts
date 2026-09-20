import type { QuizItem } from "../quizzes/service";
import type { QuestionType } from "../quizzes/schemas";
import type { StoredResponse } from "../student/grading";

/** One question of a finished attempt, with the student's answer next to the key. */
export type ReviewItem = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  pointsAwarded: number;
  isCorrect: boolean;
  answered: boolean;
  explanation: string | null;
  options: { id: string; text: string; isCorrect: boolean; selected: boolean }[];
  yourText: string | null;
  acceptedAnswers: string[] | null;
};

export function toReview(
  item: QuizItem,
  response: StoredResponse,
  graded: { isCorrect: boolean; pointsAwarded: number },
): ReviewItem {
  const selected = new Set(response?.optionIds ?? []);
  const text = response?.text?.trim() ?? "";
  const answered = item.type === "short_answer" ? text !== "" : selected.size > 0;
  return {
    id: item.id,
    type: item.type,
    prompt: item.prompt,
    points: Number(item.points),
    pointsAwarded: graded.pointsAwarded,
    isCorrect: graded.isCorrect,
    answered,
    explanation: item.explanation,
    options: item.options.map((o) => ({
      id: o.id,
      text: o.text,
      isCorrect: o.isCorrect,
      selected: selected.has(o.id),
    })),
    yourText: item.type === "short_answer" ? text || null : null,
    acceptedAnswers: item.acceptedAnswers,
  };
}
