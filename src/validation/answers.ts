import { z } from "zod";

/** Boundary validation for `answers.response`. */
export const answerResponseSchema = z.union([
  z.object({ optionIds: z.array(z.uuid()).min(1) }).strict(),
  z.object({ text: z.string().trim().min(1).max(2000) }).strict(),
]);

export type ParsedAnswerResponse = z.infer<typeof answerResponseSchema>;
