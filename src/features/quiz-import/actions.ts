"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf } from "../action-helpers";
import { ServiceError } from "../errors";
import { fieldErrorsFrom, formValue, type FormState } from "../form-state";
import { MAX_IMPORT_BYTES } from "./format";
import { parseImportSettings } from "./schemas";
import { importQuizFromExcel } from "./service";

/** Creates a draft quiz from an uploaded Excel file, then opens it. */
export async function importQuizAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("admin");

  const settings = parseImportSettings({
    title: formValue(formData, "title"),
    classId: formValue(formData, "classId"),
    timeLimitMinutes: formValue(formData, "timeLimitMinutes"),
  });
  if (!settings.success) {
    return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrorsFrom(settings.error) };
  }

  // The file comes from the browser, so it is checked here and not trusted to have been checked there.
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose the Excel file (.xlsx) to import.", fieldErrors: { file: "Choose a file" } };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { error: "That file is too big. A quiz file should be under 2 MB.", fieldErrors: { file: "Too big" } };
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return {
      error: "Only Excel .xlsx files can be imported. In Excel, use File > Save As > Excel Workbook.",
      fieldErrors: { file: "Not an .xlsx file" },
    };
  }

  let quizId: string;
  try {
    const result = await importQuizFromExcel(
      getDb(),
      ctxOf(user),
      settings.data,
      new Uint8Array(await file.arrayBuffer()),
    );
    if (!result.ok) {
      return { error: "Nothing was imported. Fix these problems in the file and upload it again:", details: result.errors };
    }
    quizId = result.id;
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
  // Outside the try block: redirect() works by throwing.
  redirect(`/admin/quizzes/${quizId}?notice=imported`);
}
