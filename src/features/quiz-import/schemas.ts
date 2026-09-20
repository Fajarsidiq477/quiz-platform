import { quizInputSchema } from "../quizzes/schemas";

/**
 * The settings an imported quiz starts with. The import page asks only for a title, a class and a
 * time limit; the rest are the same defaults as a new quiz (one attempt, results after the quiz
 * closes, no dates), and are changed on the quiz page before publishing. Reusing `quizInputSchema`
 * keeps every rule and message the same as the normal "New quiz" form.
 */
export function parseImportSettings(values: { title: string; classId: string; timeLimitMinutes: string }) {
  return quizInputSchema.safeParse({
    title: values.title,
    description: "",
    classId: values.classId,
    timeLimitMinutes: values.timeLimitMinutes,
    opensAt: "",
    closesAt: "",
    maxAttempts: "1",
    shuffleQuestions: false,
    resultsVisibility: "after_close",
  });
}
