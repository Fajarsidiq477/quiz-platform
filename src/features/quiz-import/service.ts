import { withSchool } from "@/db/tenant";
import type { AnyPgDb } from "@/db/types";
import type { Ctx } from "../errors";
import type { QuizInput } from "../quizzes/schemas";
import { addQuestionIn, createQuizIn } from "../quizzes/service";
import { parseQuizWorkbook } from "./parse";

export type ImportResult =
  | { ok: true; id: string; questionCount: number }
  | { ok: false; errors: string[] };

/**
 * Creates a draft quiz from an Excel file. All or nothing: a file with any problem creates nothing
 * and returns every problem, and the quiz and all its questions are made in one transaction, so a
 * failure part-way leaves nothing behind either. The questions are added exactly as if typed into
 * the form (versioned, published versions pinned by the quiz), so nothing else has to know the quiz
 * came from a file. `settings` is already validated (see `parseImportSettings`).
 */
export async function importQuizFromExcel(
  db: AnyPgDb,
  ctx: Ctx,
  settings: QuizInput,
  file: Uint8Array,
): Promise<ImportResult> {
  const parsed = await parseQuizWorkbook(file);
  if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors };

  const id = await withSchool(db, ctx.schoolId, async (tx) => {
    const quiz = await createQuizIn(tx, ctx, settings);
    for (const question of parsed.questions) await addQuestionIn(tx, ctx, quiz.id, question);
    return quiz.id;
  });
  return { ok: true, id, questionCount: parsed.questions.length };
}
