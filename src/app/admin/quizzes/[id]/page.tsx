import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Banner } from "@/components/admin/banner";
import { EmptyState } from "@/components/admin/empty-state";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { PageHeader } from "@/components/admin/page-header";
import { QuizForm } from "@/components/admin/quizzes/quiz-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { listClasses } from "@/features/classes/service";
import {
  closeQuizAction,
  deleteQuizAction,
  moveQuestionAction,
  publishQuizAction,
  removeQuestionAction,
  unpublishQuizAction,
  updateQuizAction,
} from "@/features/quizzes/actions";
import { QUESTION_TYPE_LABELS } from "@/features/quizzes/schemas";
import { getQuiz } from "@/features/quizzes/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Edit quiz" };

const RESULTS_LABELS = {
  after_submit: "Right after they submit",
  after_close: "After the quiz closes",
  never: "Never",
} as const;

export default async function QuizPage({ params, searchParams }: PageProps<"/admin/quizzes/[id]">) {
  const user = await requireUser("admin");
  const { id } = await params;
  const { notice } = await searchParams;

  const detail = await getQuiz(getDb(), user.schoolId, id);
  if (!detail) notFound();
  const { quiz, items, attemptCount, className } = detail;
  const isDraft = quiz.status === "draft";
  const classes = isDraft ? await listClasses(getDb(), user.schoolId) : [];
  const base = `/admin/quizzes/${quiz.id}`;

  return (
    <>
      <p className={styles.backLink}>
        <Link href="/admin/quizzes">← All quizzes</Link>
      </p>
      <PageHeader title={quiz.title} description={`Class: ${className}`} />
      <Banner code={notice} />

      {/* ------------------------------------------------------------------ status */}
      <section className={styles.section} aria-labelledby="quiz-status">
        <h2 id="quiz-status">
          Status <StatusBadge status={quiz.status} />
        </h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          {isDraft
            ? "Only you can see a draft. Students can take it once it is published and open."
            : quiz.status === "published"
              ? attemptCount > 0
                ? `Published. ${attemptCount} attempt${attemptCount === 1 ? "" : "s"} so far, so the quiz can no longer be edited.`
                : "Published. Nobody has started it yet, so you can still unpublish it to make changes."
              : "Closed. Students can no longer start it."}
        </p>
        <div className={styles.rowActions}>
          {isDraft ? (
            <ActionForm action={publishQuizAction.bind(null, quiz.id)}>
              <SubmitButton pendingLabel="Publishing…">Publish quiz</SubmitButton>
            </ActionForm>
          ) : null}
          {quiz.status === "published" && attemptCount === 0 ? (
            <ActionForm action={unpublishQuizAction.bind(null, quiz.id)}>
              <SubmitButton variant="secondary">Unpublish to edit</SubmitButton>
            </ActionForm>
          ) : null}
          {quiz.status === "published" ? (
            <ActionForm action={closeQuizAction.bind(null, quiz.id)}>
              <SubmitButton variant="secondary">Close quiz</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
        <details className={styles.details} style={{ marginTop: 12, maxWidth: 480 }}>
          <summary>Delete this quiz…</summary>
          <p>
            {attemptCount > 0
              ? "Students have attempted this quiz. It will be closed and hidden, and their results are kept."
              : "This permanently deletes the quiz. Its questions stay in the question bank."}
          </p>
          <ActionForm action={deleteQuizAction.bind(null, quiz.id)}>
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Yes, delete this quiz
            </SubmitButton>
          </ActionForm>
        </details>
      </section>

      {/* ---------------------------------------------------------------- settings */}
      <section className={styles.section} aria-labelledby="quiz-settings">
        <h2 id="quiz-settings">Settings</h2>
        {isDraft ? (
          <QuizForm
            action={updateQuizAction.bind(null, quiz.id)}
            classes={classes}
            initial={{
              title: quiz.title,
              description: quiz.description ?? "",
              classId: quiz.classId,
              timeLimitMinutes:
                quiz.timeLimitSeconds === null ? null : Math.round(quiz.timeLimitSeconds / 60),
              opensAt: quiz.opensAt?.toISOString() ?? null,
              closesAt: quiz.closesAt?.toISOString() ?? null,
              maxAttempts: quiz.maxAttempts,
              shuffleQuestions: quiz.shuffleQuestions,
              resultsVisibility: quiz.resultsVisibility,
            }}
            submitLabel="Save settings"
          />
        ) : (
          <dl className={styles.dl}>
            <dt>Class</dt>
            <dd>{className}</dd>
            <dt>Description</dt>
            <dd>{quiz.description || "—"}</dd>
            <dt>Opens</dt>
            <dd>
              <LocalDateTime iso={quiz.opensAt?.toISOString() ?? null} />
            </dd>
            <dt>Closes</dt>
            <dd>
              <LocalDateTime iso={quiz.closesAt?.toISOString() ?? null} />
            </dd>
            <dt>Time limit</dt>
            <dd>
              {quiz.timeLimitSeconds === null
                ? "None"
                : `${Math.round(quiz.timeLimitSeconds / 60)} minutes`}
            </dd>
            <dt>Attempts allowed</dt>
            <dd>{quiz.maxAttempts}</dd>
            <dt>Shuffle questions</dt>
            <dd>{quiz.shuffleQuestions ? "Yes" : "No"}</dd>
            <dt>Show results</dt>
            <dd>{RESULTS_LABELS[quiz.resultsVisibility]}</dd>
          </dl>
        )}
      </section>

      {/* --------------------------------------------------------------- questions */}
      <section className={styles.section} aria-labelledby="quiz-questions">
        <div className={styles.toolbar}>
          <h2 id="quiz-questions" style={{ marginBottom: 0 }}>
            Questions ({items.length})
          </h2>
          {isDraft ? (
            <Link href={`${base}/questions/new`} className={styles.btn}>
              Add question
            </Link>
          ) : null}
        </div>

        {items.length === 0 ? (
          <EmptyState title="No questions yet">
            {isDraft ? "Use “Add question” to write the first one." : "This quiz has no questions."}
          </EmptyState>
        ) : (
          <ol className={styles.questions}>
            {items.map((item, index) => (
              <li key={item.id} className={styles.question}>
                <div className={styles.questionHead}>
                  <strong>Question {index + 1}</strong>
                  <span>{QUESTION_TYPE_LABELS[item.type]}</span>
                  <span>
                    {Number(item.points)} {Number(item.points) === 1 ? "point" : "points"}
                  </span>
                  <span>version {item.versionNo}</span>
                </div>
                <p className={styles.prompt}>{item.prompt}</p>

                {item.options.length > 0 ? (
                  <ul className={styles.answers}>
                    {item.options.map((option) => (
                      <li key={option.id} className={option.isCorrect ? styles.correct : undefined}>
                        {option.isCorrect ? "✓ " : "○ "}
                        {option.text}
                        {option.isCorrect ? " (correct)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.acceptedAnswers ? (
                  <p className={styles.acceptedAnswers}>
                    Accepted answers: <strong>{item.acceptedAnswers.join(" · ")}</strong>
                  </p>
                ) : null}
                {item.explanation ? <p className="muted">Explanation: {item.explanation}</p> : null}

                {isDraft ? (
                  <div className={styles.rowActions}>
                    <Link
                      href={`${base}/questions/${item.id}`}
                      className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                    >
                      Edit
                    </Link>
                    {index > 0 ? (
                      <ActionForm action={moveQuestionAction.bind(null, quiz.id, item.id, "up")}>
                        <SubmitButton variant="secondary" small pendingLabel="Moving…">
                          Move up
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                    {index < items.length - 1 ? (
                      <ActionForm action={moveQuestionAction.bind(null, quiz.id, item.id, "down")}>
                        <SubmitButton variant="secondary" small pendingLabel="Moving…">
                          Move down
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                    <details className={styles.details}>
                      <summary>Remove…</summary>
                      <p>Removes it from this quiz. The question stays in the question bank.</p>
                      <ActionForm action={removeQuestionAction.bind(null, quiz.id, item.id)}>
                        <SubmitButton variant="danger" small pendingLabel="Removing…">
                          Yes, remove
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
