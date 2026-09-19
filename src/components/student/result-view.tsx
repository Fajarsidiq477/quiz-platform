import Link from "next/link";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { QUESTION_TYPE_LABELS } from "@/features/quizzes/schemas";
import type { AttemptResult, ReviewItem } from "@/features/student/service";
import styles from "./student.module.css";
import ui from "@/components/admin/admin.module.css";

function verdict(item: ReviewItem) {
  if (!item.answered) return { key: "blank", text: "Not answered" } as const;
  return item.isCorrect
    ? ({ key: "correct", text: "Correct" } as const)
    : ({ key: "wrong", text: "Incorrect" } as const);
}

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

      {result.items ? (
        <section aria-labelledby="review">
          <h2 id="review" style={{ fontSize: "1.05rem", marginBottom: 12 }}>
            Review
          </h2>
          <ol className={styles.review}>
            {result.items.map((item, index) => {
              const v = verdict(item);
              return (
                <li key={item.id} className={styles.reviewItem}>
                  <div className={styles.meta}>
                    <strong>Question {index + 1}</strong>
                    <span>{QUESTION_TYPE_LABELS[item.type]}</span>
                    <span className={`${styles.verdict} ${styles[`verdict_${v.key}`]}`}>
                      {v.text} · {item.pointsAwarded} / {item.points}
                    </span>
                  </div>
                  <p className={styles.prompt}>{item.prompt}</p>

                  {item.options.length > 0 ? (
                    <ul className={styles.reviewOptions}>
                      {item.options.map((option) => (
                        <li
                          key={option.id}
                          className={
                            option.isCorrect
                              ? styles.reviewRight
                              : option.selected
                                ? styles.reviewWrongPick
                                : undefined
                          }
                        >
                          {option.selected ? "● " : "○ "}
                          {option.text}
                          {option.selected ? " (your answer)" : ""}
                          {option.isCorrect ? " ✓ correct" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={styles.explain}>
                      <p>
                        Your answer: <strong>{item.yourText ?? "—"}</strong>
                      </p>
                      {item.acceptedAnswers ? (
                        <p>Accepted: {item.acceptedAnswers.join(" · ")}</p>
                      ) : null}
                    </div>
                  )}

                  {item.explanation ? <p className={styles.explain}>Explanation: {item.explanation}</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </>
  );
}
