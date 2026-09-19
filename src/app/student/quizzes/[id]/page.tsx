import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { ctxOf } from "@/features/action-helpers";
import { startAttemptAction } from "@/features/student/actions";
import { getMyQuiz } from "@/features/student/service";
import styles from "@/components/student/student.module.css";
import ui from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Quiz" };

const RESULTS = {
  after_submit: "Right after you hand in",
  after_close: "After the quiz closes",
  never: "Not shown",
} as const;

const STATUS = {
  in_progress: "In progress",
  submitted: "Handed in",
  graded: "Handed in",
  expired: "Time ran out",
} as const;

export default async function StudentQuizPage({ params }: PageProps<"/student/quizzes/[id]">) {
  const user = await requireUser("student");
  const { id } = await params;
  const detail = await getMyQuiz(getDb(), ctxOf(user), id);
  if (!detail) notFound();
  const { quiz, attempts } = detail;

  return (
    <>
      <p style={{ marginBottom: 12 }}>
        <Link href="/student" className={styles.note}>
          ← My quizzes
        </Link>
      </p>
      <div className={styles.pageHeader}>
        <h1>{quiz.title}</h1>
        <p className={styles.note}>{quiz.className}</p>
      </div>
      {quiz.description ? <p style={{ marginBottom: 16 }}>{quiz.description}</p> : null}

      <dl className={styles.dl}>
        <dt>Questions</dt>
        <dd>{quiz.questionCount}</dd>
        <dt>Time limit</dt>
        <dd>{quiz.timeLimitMinutes === null ? "None (open until it closes)" : `${quiz.timeLimitMinutes} minutes`}</dd>
        <dt>Opens</dt>
        <dd>
          <LocalDateTime iso={quiz.opensAt?.toISOString() ?? null} />
        </dd>
        <dt>Closes</dt>
        <dd>
          <LocalDateTime iso={quiz.closesAt?.toISOString() ?? null} />
        </dd>
        <dt>Attempts</dt>
        <dd>
          {quiz.attemptsUsed} of {quiz.maxAttempts} used
        </dd>
        <dt>Results shown</dt>
        <dd>{RESULTS[quiz.resultsVisibility]}</dd>
      </dl>

      <section className={styles.section} aria-labelledby="start">
        <h2 id="start">{quiz.phase === "in_progress" ? "Your attempt is open" : "Start"}</h2>
        {quiz.phase === "in_progress" && quiz.openAttemptId ? (
          <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
            <p className={styles.note}>You have an attempt in progress. Your answers are saved.</p>
            <Link href={`/student/attempts/${quiz.openAttemptId}`} className={ui.btn}>
              Continue quiz
            </Link>
          </div>
        ) : quiz.phase === "available" ? (
          <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
            <ul className={styles.note} style={{ paddingLeft: 18 }}>
              <li>
                The timer{quiz.timeLimitMinutes === null ? "" : ` (${quiz.timeLimitMinutes} minutes)`} starts as
                soon as you press Start, and it keeps running even if you close the page.
              </li>
              <li>Your answers are saved as you go.</li>
              <li>When time is up, your answers are handed in automatically.</li>
            </ul>
            <ActionForm action={startAttemptAction.bind(null, quiz.id)}>
              <SubmitButton pendingLabel="Starting…">
                {quiz.attemptsUsed > 0 ? "Start another attempt" : "Start quiz"}
              </SubmitButton>
            </ActionForm>
          </div>
        ) : quiz.phase === "upcoming" ? (
          <p className={styles.note}>
            This quiz opens <LocalDateTime iso={quiz.opensAt?.toISOString() ?? null} />.
          </p>
        ) : quiz.phase === "completed" ? (
          <p className={styles.note}>
            {quiz.attemptsUsed >= quiz.maxAttempts
              ? "You have used all your attempts."
              : "This quiz is closed, so you cannot start another attempt."}
          </p>
        ) : (
          <p className={styles.note}>This quiz is closed and you did not take it.</p>
        )}
      </section>

      {attempts.length > 0 ? (
        <section className={styles.section} aria-labelledby="attempts">
          <h2 id="attempts">Your attempts</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Started</th>
                  <th scope="col">Status</th>
                  <th scope="col">Score</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.attemptNo}</td>
                    <td>
                      <LocalDateTime iso={a.startedAt.toISOString()} />
                    </td>
                    <td>{STATUS[a.status]}</td>
                    <td>
                      {a.status === "in_progress"
                        ? "—"
                        : a.resultsVisible && a.score !== null
                          ? `${a.score} / ${a.maxScore}`
                          : "Hidden for now"}
                    </td>
                    <td>
                      <Link href={`/student/attempts/${a.id}`}>
                        {a.status === "in_progress" ? "Continue" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
