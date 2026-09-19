import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { PageHeader } from "@/components/admin/page-header";
import { draftFromItem } from "@/components/admin/quizzes/question-draft";
import { QuestionForm } from "@/components/admin/quizzes/question-form";
import { saveQuestionAction } from "@/features/quizzes/actions";
import { getQuiz } from "@/features/quizzes/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({
  params,
}: PageProps<"/admin/quizzes/[id]/questions/[itemId]">) {
  const user = await requireUser("admin");
  const { id, itemId } = await params;
  const detail = await getQuiz(getDb(), user.schoolId, id);
  if (!detail) notFound();
  const back = `/admin/quizzes/${detail.quiz.id}`;
  if (detail.quiz.status !== "draft") redirect(back);

  const item = detail.items.find((i) => i.id === itemId);
  if (!item) notFound();

  return (
    <>
      <p className={styles.backLink}>
        <Link href={back}>← Back to “{detail.quiz.title}”</Link>
      </p>
      <PageHeader
        title="Edit question"
        description="Changing the wording or answers saves a new version; earlier versions are kept."
      />
      <QuestionForm
        action={saveQuestionAction.bind(null, detail.quiz.id, item.id)}
        initial={draftFromItem(item)}
        submitLabel="Save question"
        cancelHref={back}
      />
    </>
  );
}
