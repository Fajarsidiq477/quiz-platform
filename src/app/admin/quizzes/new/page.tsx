import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { NEW_QUIZ_DEFAULTS, QuizForm } from "@/components/admin/quizzes/quiz-form";
import { listClasses } from "@/features/classes/service";
import { createQuizAction } from "@/features/quizzes/actions";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "New quiz" };

export default async function NewQuizPage() {
  const user = await requireUser("admin");
  const classes = await listClasses(getDb(), user.schoolId);

  return (
    <>
      <p className={styles.backLink}>
        <Link href="/admin/quizzes">← All quizzes</Link>
      </p>
      <PageHeader title="New quiz" description="Set it up now; you add the questions next." />
      {classes.length === 0 ? (
        <EmptyState title="Create a class first">
          Every quiz belongs to a class. <Link href="/admin/classes">Go to Classes</Link> to add one.
        </EmptyState>
      ) : (
        <QuizForm
          action={createQuizAction}
          classes={classes}
          initial={{ ...NEW_QUIZ_DEFAULTS, classId: classes[0].id }}
          submitLabel="Create quiz"
          cancelHref="/admin/quizzes"
        />
      )}
    </>
  );
}
