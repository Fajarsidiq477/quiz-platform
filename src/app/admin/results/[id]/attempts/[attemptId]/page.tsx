import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { EmptyState } from "@/components/admin/empty-state";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { PageHeader } from "@/components/admin/page-header";
import { pct, score } from "@/components/admin/results/format";
import { ReviewList } from "@/components/results/review-list";
import { ctxOf } from "@/features/action-helpers";
import { AWAY_REASON_LABELS, formatAway } from "@/features/attempts/away";
import { getAttemptReview } from "@/features/results/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Attempt review" };

export default async function AttemptReviewPage({
  params,
}: PageProps<"/admin/results/[id]/attempts/[attemptId]">) {
  const user = await requireUser("admin");
  const { id, attemptId } = await params;

  const review = await getAttemptReview(getDb(), ctxOf(user), id, attemptId);
  if (!review) notFound();
  const { student, attempt, quiz } = review;
  const base = `/admin/results/${quiz.id}`;

  return (
    <>
      <p className={styles.backLink}>
        <Link href={base}>← Results for {quiz.title}</Link>
      </p>
      <PageHeader
        title={student.name}
        description={`${student.email} · ${quiz.className} · attempt ${attempt.attemptNo}`}
      />

      <dl className={styles.dl} style={{ marginBottom: 20 }}>
        <dt>Started</dt>
        <dd>
          <LocalDateTime iso={attempt.startedAt.toISOString()} />
        </dd>
        <dt>{attempt.inProgress ? "Status" : "Handed in"}</dt>
        <dd>
          {attempt.inProgress ? (
            "Still in progress"
          ) : (
            <>
              <LocalDateTime iso={attempt.submittedAt?.toISOString() ?? null} />
              {attempt.timedOut ? " (time ran out)" : ""}
            </>
          )}
        </dd>
        <dt>Score</dt>
        <dd>
          {attempt.score !== null && attempt.maxScore !== null && attempt.percent !== null ? (
            <strong>
              {score(attempt.score, attempt.maxScore)} ({pct(attempt.percent)})
            </strong>
          ) : (
            "—"
          )}
        </dd>
      </dl>

      {review.attempts.length > 1 ? (
        <section className={styles.section} aria-labelledby="all-attempts">
          <h2 id="all-attempts">This student&rsquo;s attempts</h2>
          <div className={styles.attemptPills}>
            {review.attempts.map((a) => (
              <Link
                key={a.id}
                href={`${base}/attempts/${a.id}`}
                aria-current={a.id === attempt.id ? "page" : undefined}
              >
                Attempt {a.attemptNo}
                {a.inProgress
                  ? " · in progress"
                  : a.score !== null && a.maxScore !== null
                    ? ` · ${score(a.score, a.maxScore)}`
                    : ""}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="time-away">
        <h2 id="time-away">Time away from the quiz</h2>
        {!review.away.tracked ? (
          <p className={styles.subtle}>
            Time away was not recorded for this attempt: it was started before that feature existed.
            This does not mean the student stayed on the page.
          </p>
        ) : review.away.count === 0 ? (
          <p className={styles.subtle}>
            The student did not leave the quiz page{attempt.inProgress ? " so far" : ""}. Absences
            shorter than about a second are not counted.
          </p>
        ) : (
          <>
            <p style={{ marginBottom: 10 }}>
              Left the page <strong>{review.away.count}</strong>{" "}
              {review.away.count === 1 ? "time" : "times"}, <strong>{formatAway(review.away.totalMs)}</strong>{" "}
              in total (longest {formatAway(review.away.longestMs)}).
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Left at</th>
                    <th scope="col">Away for</th>
                    <th scope="col">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {review.away.entries.map((entry) => (
                    <tr key={entry.startedAt.toISOString()}>
                      <td>
                        <LocalDateTime iso={entry.startedAt.toISOString()} />
                      </td>
                      <td className={styles.numeric}>
                        {formatAway(entry.ms)}
                        {entry.neverReturned ? (
                          <div className={styles.subtle}>
                            {attempt.inProgress ? "still away" : "did not come back before the end"}
                          </div>
                        ) : null}
                      </td>
                      <td>{AWAY_REASON_LABELS[entry.reason]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {review.items ? (
        <ReviewList items={review.items} voice="teacher" />
      ) : (
        <EmptyState title="This attempt is still in progress">
          Answers are shown once the student hands in, or when the time runs out.
        </EmptyState>
      )}
    </>
  );
}
