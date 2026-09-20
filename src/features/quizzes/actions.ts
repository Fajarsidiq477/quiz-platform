"use server";

import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf, runAction } from "../action-helpers";
import { fieldErrorsFrom, formValue, type FormState } from "../form-state";
import { questionInputSchema, quizInputSchema, quizRulesSchema } from "./schemas";
import {
  addQuestion,
  closeQuiz,
  createQuiz,
  deleteQuiz,
  moveQuestion,
  publishQuiz,
  removeQuestion,
  reopenQuiz,
  unpublishQuiz,
  updateQuestion,
  updateQuiz,
  updateQuizRules,
} from "./service";

const quizPath = (id: string) => `/admin/quizzes/${id}`;

function parseQuizForm(formData: FormData) {
  return quizInputSchema.safeParse({
    title: formValue(formData, "title"),
    description: formValue(formData, "description"),
    classId: formValue(formData, "classId"),
    timeLimitMinutes: formValue(formData, "timeLimitMinutes"),
    opensAt: formValue(formData, "opensAt"),
    closesAt: formValue(formData, "closesAt"),
    maxAttempts: formValue(formData, "maxAttempts"),
    shuffleQuestions: formData.get("shuffleQuestions") === "on",
    resultsVisibility: formValue(formData, "resultsVisibility"),
  });
}

function parseRulesForm(formData: FormData) {
  return quizRulesSchema.safeParse({
    title: formValue(formData, "title"),
    description: formValue(formData, "description"),
    opensAt: formValue(formData, "opensAt"),
    closesAt: formValue(formData, "closesAt"),
    maxAttempts: formValue(formData, "maxAttempts"),
    shuffleQuestions: formData.get("shuffleQuestions") === "on",
    resultsVisibility: formValue(formData, "resultsVisibility"),
  });
}

const invalid = (error: import("zod").ZodError): FormState => ({
  error: "Please fix the highlighted fields.",
  fieldErrors: fieldErrorsFrom(error),
});

export async function createQuizAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("admin");
  const parsed = parseQuizForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const { id } = await createQuiz(getDb(), ctxOf(user), parsed.data);
    return `${quizPath(id)}?notice=created`;
  });
}

export async function updateQuizAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser("admin");
  const parsed = parseQuizForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await updateQuiz(getDb(), ctxOf(user), id, parsed.data);
    return `${quizPath(id)}?notice=saved`;
  });
}

export async function publishQuizAction(
  id: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await publishQuiz(getDb(), ctxOf(user), id);
    return `${quizPath(id)}?notice=published`;
  });
}

export async function unpublishQuizAction(
  id: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await unpublishQuiz(getDb(), ctxOf(user), id);
    return `${quizPath(id)}?notice=unpublished`;
  });
}

export async function closeQuizAction(
  id: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await closeQuiz(getDb(), ctxOf(user), id);
    return `${quizPath(id)}?notice=closed`;
  });
}

/** Reopens a closed quiz that students have attempted: same results, new rules. */
export async function reopenQuizAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser("admin");
  const parsed = parseRulesForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    const outcome = await reopenQuiz(getDb(), ctxOf(user), id, parsed.data);
    return `${quizPath(id)}?notice=${outcome === "draft" ? "reopened_draft" : "reopened"}`;
  });
}

/** Reopens a closed quiz nobody attempted, as a draft that can be edited freely. */
export async function reopenQuizAsDraftAction(
  id: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await reopenQuiz(getDb(), ctxOf(user), id, null);
    return `${quizPath(id)}?notice=reopened_draft`;
  });
}

/** Changes the rules of a published or closed quiz (window, attempts, shuffle, results shown). */
export async function updateQuizRulesAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser("admin");
  const parsed = parseRulesForm(formData);
  if (!parsed.success) return invalid(parsed.error);
  return runAction(async () => {
    await updateQuizRules(getDb(), ctxOf(user), id, parsed.data);
    return `${quizPath(id)}?notice=rules_saved`;
  });
}

export async function deleteQuizAction(
  id: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    const outcome = await deleteQuiz(getDb(), ctxOf(user), id);
    return `/admin/quizzes?notice=${outcome}`;
  });
}

/** Creates a question when `itemId` is null, otherwise edits that question of the quiz. */
export async function saveQuestionAction(
  quizId: string,
  itemId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser("admin");

  let raw: unknown;
  try {
    raw = JSON.parse(formValue(formData, "payload"));
  } catch {
    return { error: "Could not read the question. Please try again." };
  }
  const parsed = questionInputSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);

  return runAction(async () => {
    if (itemId) await updateQuestion(getDb(), ctxOf(user), quizId, itemId, parsed.data);
    else await addQuestion(getDb(), ctxOf(user), quizId, parsed.data);
    return `${quizPath(quizId)}?notice=question_saved`;
  });
}

export async function removeQuestionAction(
  quizId: string,
  itemId: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await removeQuestion(getDb(), ctxOf(user), quizId, itemId);
    return `${quizPath(quizId)}?notice=question_removed`;
  });
}

export async function moveQuestionAction(
  quizId: string,
  itemId: string,
  direction: "up" | "down",
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await moveQuestion(getDb(), ctxOf(user), quizId, itemId, direction === "up" ? "up" : "down");
    return quizPath(quizId);
  });
}
