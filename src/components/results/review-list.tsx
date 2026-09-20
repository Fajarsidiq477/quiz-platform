import type { ReviewItem } from "@/features/attempts/review";
import { QUESTION_TYPE_LABELS } from "@/features/quizzes/schemas";
import styles from "@/components/student/student.module.css";

function verdict(item: ReviewItem) {
  if (!item.answered) return { key: "blank", text: "Not answered" } as const;
  return item.isCorrect
    ? ({ key: "correct", text: "Correct" } as const)
    : ({ key: "wrong", text: "Incorrect" } as const);
}

/**
 * A finished attempt question by question: the student's answer next to the correct one. Used for a
 * student's own result and for a teacher reviewing that student's attempt, so both look the same.
 */
export function ReviewList({
  items,
  voice = "student",
}: {
  items: ReviewItem[];
  /** "student" says "your answer"; "teacher" says "answer given". */
  voice?: "student" | "teacher";
}) {
  const given = voice === "student" ? "your answer" : "answer given";
  return (
    <section aria-labelledby="review">
      <h2 id="review" style={{ fontSize: "1.05rem", marginBottom: 12 }}>
        Review
      </h2>
      <ol className={styles.review}>
        {items.map((item, index) => {
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
                      {option.selected ? ` (${given})` : ""}
                      {option.isCorrect ? " ✓ correct" : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.explain}>
                  <p>
                    {voice === "student" ? "Your answer" : "Answer given"}: <strong>{item.yourText ?? "—"}</strong>
                  </p>
                  {item.acceptedAnswers ? <p>Accepted: {item.acceptedAnswers.join(" · ")}</p> : null}
                </div>
              )}

              {item.explanation ? (
                <p className={styles.explain}>Explanation: {item.explanation}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
