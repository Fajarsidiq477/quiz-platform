import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Quiz settings
// ---------------------------------------------------------------------------------------------

/** Empty form fields arrive as "" and mean "not set". */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const optionalDate = z.preprocess(
  blankToNull,
  z.iso
    .datetime({ offset: true, error: "Enter a valid date and time" })
    .nullable()
    .transform((v) => (v ? new Date(v) : null)),
);

/** A date that must be filled in: a quiz that is not a draft always has its window. */
const requiredDate = z.preprocess(
  blankToNull,
  z
    .string({ error: "Choose a date and time" })
    .pipe(z.iso.datetime({ offset: true, error: "Enter a valid date and time" }))
    .transform((v) => new Date(v)),
);

export const RESULTS_VISIBILITY = ["never", "after_submit", "after_close"] as const;

// Shared by the full settings form (a draft) and the rules form (a quiz students have attempted).
const titleField = z.string().trim().min(1, "Title is required").max(200, "Use at most 200 characters");
const descriptionField = z
  .string()
  .trim()
  .max(2000, "Use at most 2000 characters")
  .transform((v) => v || null);
const maxAttemptsField = z.coerce
  .number({ error: "Enter a number of attempts" })
  .int("Use a whole number")
  .min(1, "At least 1 attempt")
  .max(20, "At most 20 attempts");
const resultsVisibilityField = z.enum(RESULTS_VISIBILITY, {
  error: "Choose when results are shown",
});

export const quizInputSchema = z
  .object({
    title: titleField,
    description: descriptionField,
    classId: z.uuid("Choose a class"),
    /** Blank = untimed: the attempt then ends at the closing time. */
    timeLimitMinutes: z.preprocess(
      blankToNull,
      z.coerce
        .number({ error: "Enter a number of minutes" })
        .int("Use whole minutes")
        .min(1, "At least 1 minute")
        .max(600, "At most 600 minutes")
        .nullable(),
    ),
    opensAt: optionalDate,
    closesAt: optionalDate,
    maxAttempts: maxAttemptsField,
    shuffleQuestions: z.boolean(),
    resultsVisibility: resultsVisibilityField,
  })
  .refine((v) => !v.opensAt || !v.closesAt || v.opensAt < v.closesAt, {
    message: "The closing time must be after the opening time",
    path: ["closesAt"],
  });

export type QuizInput = z.output<typeof quizInputSchema>;

/**
 * What can still be changed once students have attempted a quiz. The class, the time limit and the
 * questions are not here: the database freezes them while any attempt exists.
 */
export const quizRulesSchema = z
  .object({
    title: titleField,
    description: descriptionField,
    opensAt: requiredDate,
    closesAt: requiredDate,
    maxAttempts: maxAttemptsField,
    shuffleQuestions: z.boolean(),
    resultsVisibility: resultsVisibilityField,
  })
  .refine((v) => v.opensAt < v.closesAt, {
    message: "The closing time must be after the opening time",
    path: ["closesAt"],
  });

export type QuizRulesInput = z.output<typeof quizRulesSchema>;

// ---------------------------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------------------------

export const QUESTION_TYPES = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: "Single choice",
  multiple_choice: "Multiple choice",
  true_false: "True / false",
  short_answer: "Short answer",
};

const points = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? 1 : v),
  z.coerce
    .number({ error: "Enter the points" })
    .min(0, "Points cannot be negative")
    .max(1000, "At most 1000 points")
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, "Use at most 2 decimals"),
);

const common = {
  prompt: z.string().trim().min(1, "Write the question").max(5000, "Use at most 5000 characters"),
  points,
  explanation: z
    .string()
    .trim()
    .max(2000, "Use at most 2000 characters")
    .nullish()
    .transform((v) => v || null),
};

const optionSchema = z.object({
  text: z.string().trim().min(1, "Every option needs text").max(500, "Use at most 500 characters"),
  isCorrect: z.boolean(),
});

const correctCount = (options: { isCorrect: boolean }[]) =>
  options.filter((o) => o.isCorrect).length;

const singleChoice = z
  .object({
    type: z.literal("single_choice"),
    ...common,
    options: z.array(optionSchema).min(2, "Add at least 2 options").max(10, "At most 10 options"),
  })
  .refine((v) => correctCount(v.options) === 1, {
    message: "Mark exactly one correct option",
    path: ["options"],
  });

const multipleChoice = z
  .object({
    type: z.literal("multiple_choice"),
    ...common,
    options: z.array(optionSchema).min(2, "Add at least 2 options").max(10, "At most 10 options"),
  })
  .refine((v) => correctCount(v.options) >= 1, {
    message: "Mark at least one correct option",
    path: ["options"],
  });

const trueFalse = z.object({ type: z.literal("true_false"), ...common, correct: z.boolean() });

const shortAnswer = z.object({
  type: z.literal("short_answer"),
  ...common,
  acceptedAnswers: z
    .array(z.string().trim().min(1).max(200, "Each answer can use at most 200 characters"))
    .min(1, "List at least one accepted answer")
    .max(20, "At most 20 accepted answers")
    .transform((list) => [...new Set(list)]),
});

export const questionInputSchema = z.discriminatedUnion("type", [
  singleChoice,
  multipleChoice,
  trueFalse,
  shortAnswer,
]);

export type QuestionInput = z.output<typeof questionInputSchema>;
