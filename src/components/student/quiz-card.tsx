import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { startAttemptAction } from "@/features/student/actions";
import type { StudentQuiz } from "@/features/student/service";
import styles from "./student.module.css";
import ui from "@/components/admin/admin.module.css";

export function QuizCard({ quiz }: { quiz: StudentQuiz }) {
  const closes = quiz.closesAt?.toISOString() ?? null;
  const opens = quiz.opensAt?.toISOString() ?? null;
  const last = quiz.latestAttempt;
  const attemptsLeft = quiz.maxAttempts - quiz.attemptsUsed;

  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <h3 className={styles.cardTitle}>
          <Link href={`/student/quizzes/${quiz.id}`}>{quiz.title}</Link>
        </h3>
        <span className={styles.note}>{quiz.className}</span>
      </div>

      <div className={styles.meta}>
        <span>
          {quiz.questionCount} {quiz.questionCount === 1 ? "question" : "questions"}
        </span>
        <span>{quiz.timeLimitMinutes === null ? "No time limit" : `${quiz.timeLimitMinutes} minutes`}</span>
        <span>
          Attempts: {quiz.attemptsUsed} of {quiz.maxAttempts}
        </span>
        {quiz.phase === "upcoming" ? (
          <span>
            Opens <LocalDateTime iso={opens} />
          </span>
        ) : quiz.status === "published" ? (
          <span>
            Closes <LocalDateTime iso={closes} />
          </span>
        ) : null}
      </div>

      <div className={styles.cardFoot}>
        {quiz.phase === "in_progress" && quiz.openAttemptId ? (
          <Link href={`/student/attempts/${quiz.openAttemptId}`} className={ui.btn}>
            Continue quiz
          </Link>
        ) : null}

        {quiz.phase === "available" ? (
          <ActionForm action={startAttemptAction.bind(null, quiz.id)}>
            <SubmitButton pendingLabel="Starting…">
              {quiz.attemptsUsed > 0 ? "Try again" : "Start quiz"}
            </SubmitButton>
          </ActionForm>
        ) : null}

        {quiz.phase === "upcoming" ? <span className={styles.note}>Not open yet</span> : null}
        {quiz.phase === "missed" ? <span className={styles.note}>You did not take this quiz.</span> : null}

        {last && last.status !== "in_progress" ? (
          <>
            {last.resultsVisible && last.score !== null && last.maxScore !== null ? (
              <span className={styles.scoreChip}>
                Score: {last.score} / {last.maxScore}
              </span>
            ) : (
              <span className={styles.note}>Submitted</span>
            )}
            <Link
              href={`/student/attempts/${last.id}`}
              className={`${ui.btn} ${ui.btnSecondary} ${ui.btnSmall}`}
            >
              View result
            </Link>
          </>
        ) : null}

        {quiz.phase === "completed" && attemptsLeft <= 0 ? (
          <span className={styles.note}>No attempts left</span>
        ) : null}
      </div>
    </li>
  );
}
