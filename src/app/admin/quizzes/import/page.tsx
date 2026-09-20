import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { QuizImportForm } from "@/components/admin/quizzes/quiz-import-form";
import { listClasses } from "@/features/classes/service";
import { importQuizAction } from "@/features/quiz-import/actions";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Import quiz" };

export default async function ImportQuizPage() {
  const user = await requireUser("admin");
  const classes = await listClasses(getDb(), user.schoolId);

  return (
    <>
      <p className={styles.backLink}>
        <Link href="/admin/quizzes">← All quizzes</Link>
      </p>
      <PageHeader
        title="Import quiz from Excel"
        description="Write the questions in a spreadsheet and create the quiz from it in one step."
      />

      <section className={styles.section} aria-labelledby="import-steps">
        <h2 id="import-steps">How it works</h2>
        <ol style={{ margin: "0 0 12px 20px", display: "grid", gap: 4, maxWidth: 640 }}>
          <li>Download the example file and fill in one question per row.</li>
          <li>Choose the file below, with a title, the class and the time limit.</li>
          <li>The quiz is created as a draft. Set the dates and publish it when you are ready.</li>
        </ol>
        <a href="/admin/quizzes/import/template" className={styles.btn} download>
          Download example (.xlsx)
        </a>
        <p className="muted" style={{ marginTop: 10, maxWidth: 640 }}>
          The example has one question of each type and a sheet that explains every column. Nothing is
          imported if any row has a problem: you get the list of rows to fix.
        </p>
      </section>

      {classes.length === 0 ? (
        <EmptyState title="Create a class first">
          Every quiz belongs to a class. <Link href="/admin/classes">Go to Classes</Link> to add one.
        </EmptyState>
      ) : (
        <section className={styles.section} aria-labelledby="import-form">
          <h2 id="import-form">Import</h2>
          <QuizImportForm action={importQuizAction} classes={classes} cancelHref="/admin/quizzes" />
        </section>
      )}
    </>
  );
}
