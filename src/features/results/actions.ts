"use server";

import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf, runAction } from "../action-helpers";
import type { FormState } from "../form-state";
import { deleteStudentResult } from "./service";

/** Permanently deletes one student's attempts and answers on a quiz. */
export async function deleteStudentResultAction(
  quizId: string,
  studentId: string,
): Promise<FormState> {
  const user = await requireUser("admin");
  return runAction(async () => {
    await deleteStudentResult(getDb(), ctxOf(user), quizId, studentId);
    return `/admin/results/${quizId}?notice=result_deleted`;
  });
}
