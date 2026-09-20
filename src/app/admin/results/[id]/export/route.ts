import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf } from "@/features/action-helpers";
import { buildResultsCsv, csvFileName } from "@/features/results/csv";
import { getQuizResults, sortRows } from "@/features/results/service";

/** The results table as a spreadsheet file. Admins only, like every page under /admin. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/results/[id]/export">) {
  const user = await requireUser("admin");
  const { id } = await params;

  const results = await getQuizResults(getDb(), ctxOf(user), id);
  if (!results) return new Response("Not found", { status: 404 });

  const csv = buildResultsCsv({ ...results, rows: sortRows(results.rows, "name") });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(results.quiz.title)}"`,
      // Student data: never cached by the browser or a proxy.
      "Cache-Control": "no-store",
    },
  });
}
