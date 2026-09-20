import { requireUser } from "@/auth/dal";
import { TEMPLATE_FILE_NAME, XLSX_CONTENT_TYPE } from "@/features/quiz-import/format";
import { buildTemplate } from "@/features/quiz-import/template";

/** The example workbook to fill in and import. Admins only, like every page under /admin. */
export async function GET() {
  await requireUser("admin");
  const file = await buildTemplate();
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${TEMPLATE_FILE_NAME}"`,
      "Content-Length": String(file.length),
    },
  });
}
