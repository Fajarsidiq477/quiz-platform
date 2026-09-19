"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf, runAction } from "../action-helpers";
import { ServiceError } from "../errors";
import type { FormState } from "../form-state";
import { saveAnswer, startAttempt, submitAttempt } from "./service";
import type { SaveResult, SubmitResult } from "./types";

/** Starts the quiz (or resumes the open attempt) and goes to it. Safe to click twice. */
export async function startAttemptAction(quizId: string): Promise<FormState> {
  const user = await requireUser("student");
  return runAction(async () => {
    const { attemptId } = await startAttempt(getDb(), ctxOf(user), quizId);
    return `/student/attempts/${attemptId}`;
  });
}

/**
 * Called by the quiz page (not a form) each time an answer changes. Returns the time left by the
 * database clock so the countdown can re-sync; the browser's own clock is never trusted.
 */
export async function saveAnswerAction(
  attemptId: string,
  itemId: string,
  response: unknown,
): Promise<SaveResult> {
  const user = await requireUser("student");
  try {
    const { remainingMs } = await saveAnswer(getDb(), ctxOf(user), attemptId, itemId, response);
    return { ok: true, remainingMs };
  } catch (error) {
    if (error instanceof ServiceError) {
      return { ok: false, error: error.message, final: error.code === "invalid_state" };
    }
    throw error;
  }
}

/** Hands in the attempt with the browser's full set of answers, then shows the result. */
export async function submitAttemptAction(
  attemptId: string,
  answers: unknown,
): Promise<SubmitResult> {
  const user = await requireUser("student");

  const snapshot = z.record(z.string(), z.unknown()).safeParse(answers);
  if (!snapshot.success) return { ok: false, error: "Your answers could not be read." };

  try {
    await submitAttempt(getDb(), ctxOf(user), attemptId, snapshot.data);
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: error.message };
    throw error;
  }
  // Outside the try block: redirect() works by throwing.
  redirect(`/student/attempts/${attemptId}`);
}
