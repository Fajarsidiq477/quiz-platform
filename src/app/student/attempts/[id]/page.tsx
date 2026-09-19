import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ctxOf } from "@/features/action-helpers";
import { saveAnswerAction, submitAttemptAction } from "@/features/student/actions";
import { getAttemptPage, getMyQuiz } from "@/features/student/service";
import { AttemptRunner } from "@/components/student/attempt-runner";
import { ResultView } from "@/components/student/result-view";

export const metadata: Metadata = { title: "Quiz" };

export default async function AttemptPage({ params }: PageProps<"/student/attempts/[id]">) {
  const user = await requireUser("student");
  const { id } = await params;
  const ctx = ctxOf(user);

  const page = await getAttemptPage(getDb(), ctx, id);
  if (!page) notFound();

  // Time left and whether this attempt is still open are decided by the server. If it is open, the
  // questions are shown; otherwise (submitted, or time ran out) this is the result.
  if (page.kind === "taking") {
    return (
      <AttemptRunner
        title={page.quiz.title}
        description={page.quiz.description}
        items={page.items}
        initialAnswers={page.answers}
        initialRemainingMs={page.remainingMs}
        save={saveAnswerAction.bind(null, page.attemptId)}
        submit={submitAttemptAction.bind(null, page.attemptId)}
      />
    );
  }

  const quiz = await getMyQuiz(getDb(), ctx, page.quiz.id);
  const canRetry = quiz?.quiz.phase === "available";
  return <ResultView result={page} canRetry={canRetry} />;
}
