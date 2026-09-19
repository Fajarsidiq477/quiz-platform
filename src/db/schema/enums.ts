import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["student", "teacher", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const enrollmentStatus = pgEnum("enrollment_status", ["active", "withdrawn"]);
export const questionType = pgEnum("question_type", [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
]);
export const quizStatus = pgEnum("quiz_status", ["draft", "published", "closed"]);
export const resultsVisibility = pgEnum("results_visibility", [
  "never",
  "after_submit",
  "after_close",
]);
export const attemptStatus = pgEnum("attempt_status", [
  "in_progress",
  "submitted",
  "expired",
  "graded",
]);
