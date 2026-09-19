import { z } from "zod";
import { ServiceError } from "../errors";
import type { QuestionType } from "../quizzes/schemas";

export type AnswerPayload = { optionIds: string[] } | { text: string };

const bad = () => new ServiceError("That answer could not be read. Please try again.", "invalid_input");

/**
 * Checks a saved answer against the question it belongs to: option ids must be this question's own
 * options, single-choice and true/false allow at most one, and text is trimmed and length-limited.
 * An empty selection or empty text is allowed and means "cleared" (the answer counts as blank).
 */
export function parseAnswer(
  item: { type: QuestionType; options: { id: string }[] },
  raw: unknown,
): AnswerPayload {
  if (item.type === "short_answer") {
    const parsed = z.object({ text: z.string().max(2000) }).strict().safeParse(raw);
    if (!parsed.success) throw bad();
    return { text: parsed.data.text.trim() };
  }

  const parsed = z
    .object({ optionIds: z.array(z.uuid()).max(10) })
    .strict()
    .safeParse(raw);
  if (!parsed.success) throw bad();

  const ids = parsed.data.optionIds;
  const own = new Set(item.options.map((o) => o.id));
  if (new Set(ids).size !== ids.length || !ids.every((id) => own.has(id))) throw bad();
  if (item.type !== "multiple_choice" && ids.length > 1) throw bad();
  return { optionIds: ids };
}
