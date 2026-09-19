import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { PageHeader } from "@/components/admin/page-header";
import { QuestionForm } from "@/components/admin/quizzes/question-form";
import { saveQuestionAction } from "@/features/quizzes/actions";
import { getQuiz } from "@/features/quizzes/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Add question" };

export default async function NewQuestionPage({
  params,
}: PageProps<"/admin/quizzes/[id]/questions/new">) {
  const user = await requireUser("admin");
  const { id } = await params;
  const detail = await getQuiz(getDb(), user.schoolId, id);
  if (!detail) notFound();
  const back = `/admin/quizzes/${detail.quiz.id}`;
  // Only a draft can be changed; anything else goes back to the quiz page.
  if (detail.quiz.status !== "draft") redirect(back);

  return (
    <>
      <p className={styles.backLink}>
        <Link href={back}>← Back to “{detail.quiz.title}”</Link>
      </p>
      <PageHeader title="Add question" description={`It will be added at the end of the quiz.`} />
      <QuestionForm
        action={saveQuestionAction.bind(null, detail.quiz.id, null)}
        submitLabel="Add question"
        cancelHref={back}
      />
    </>
  );
}
