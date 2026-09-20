import Link from "next/link";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { ReviewList } from "@/components/results/review-list";
import type { AttemptResult } from "@/features/student/service";
import styles from "./student.module.css";
import ui from "@/components/admin/admin.module.css";

export function ResultView({ result, canRetry }: { result: AttemptResult; canRetry: boolean }) {
  const percent =
    result.score !== null && result.maxScore ? Math.round((result.score / result.maxScore) * 100) : null;

  return (
    <>
      <p style={{ marginBottom: 12 }}>
        <Link href={`/student/quizzes/${result.quiz.id}`} className={styles.note}>
          ← Back to {result.quiz.title}
        </Link>
      </p>
      <div className={styles.pageHeader}>
        <h1>{result.quiz.title}</h1>
        <p className={styles.note}>
          Attempt {result.attemptNo} · started <LocalDateTime iso={result.startedAt.toISOString()} />
          {result.status === "graded" && result.submittedAt ? (
            <>
              {" "}
              · handed in <LocalDateTime iso={result.submittedAt.toISOString()} />
            </>
          ) : null}
        </p>
      </div>

      {!result.visible ? (
        <div className={styles.scoreBox}>
          <h2>Your answers are in</h2>
          <p>{result.hiddenReason}</p>
        </div>
      ) : (
        <div className={styles.scoreBox} aria-label="Your score">
          <span className={styles.note}>Your score</span>
          <span className={styles.scoreBig}>
            {result.score} / {result.maxScore}
          </span>
          {percent !== null ? <span className={styles.note}>{percent}%</span> : null}
        </div>
      )}

      <div className={ui.formActions} style={{ marginBottom: 24 }}>
        <Link href="/student" className={`${ui.btn} ${ui.btnSecondary}`}>
          All my quizzes
        </Link>
        {canRetry ? (
          <Link href={`/student/quizzes/${result.quiz.id}`} className={ui.btn}>
            Try again
          </Link>
        ) : null}
      </div>

      {result.items ? <ReviewList items={result.items} /> : null}
    </>
  );
}
