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
import { num, pct, score } from "@/components/admin/results/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { ctxOf } from "@/features/action-helpers";
import { formatAway } from "@/features/attempts/away";
import { QUESTION_TYPE_LABELS } from "@/features/quizzes/schemas";
import { deleteStudentResultAction } from "@/features/results/actions";
import { getQuizResults, parseSort, sortRows, type ResultRow } from "@/features/results/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Quiz results" };

const STATE_TEXT: Record<ResultRow["state"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  finished: "Finished",
};

/** Green at or above 75% correct, amber from 50%, red below. */
function meterClass(percent: number | null) {
  if (percent === null) return "";
  return percent >= 75 ? styles.meterFillGood : percent >= 50 ? styles.meterFillMid : styles.meterFillLow;
}

function Meter({ percent }: { percent: number | null }) {
  return (
    <div className={styles.meterTrack} aria-hidden="true">
      <div
        className={`${styles.meterFill} ${meterClass(percent)}`}
        style={{ width: `${Math.max(0, Math.min(100, percent ?? 0))}%` }}
      />
    </div>
  );
}

export default async function QuizResultsPage({
  params,
  searchParams,
}: PageProps<"/admin/results/[id]">) {
  const user = await requireUser("admin");
  const { id } = await params;
  const { sort: sortParam, notice } = await searchParams;
  const sort = parseSort(sortParam);

  const results = await getQuizResults(getDb(), ctxOf(user), id);
  if (!results) notFound();
  const { quiz, summary, questions } = results;
  const rows = sortRows(results.rows, sort);
  const base = `/admin/results/${quiz.id}`;

  return (
    <>
      <p className={styles.backLink}>
        <Link href="/admin/results">← All results</Link>
      </p>
      <PageHeader
        title={quiz.title}
        description={`${quiz.className} · ${quiz.questionCount} ${quiz.questionCount === 1 ? "question" : "questions"} · ${num(quiz.maxScore)} points · up to ${quiz.maxAttempts} ${quiz.maxAttempts === 1 ? "attempt" : "attempts"}`}
      />

      <Banner code={notice} />

      <div className={styles.formActions} style={{ marginBottom: 20 }}>
        <StatusBadge status={quiz.status} />
        <a href={`${base}/export`} className={styles.btn} download>
          Download CSV
        </a>
        <Link href={`/admin/quizzes/${quiz.id}`} className={`${styles.btn} ${styles.btnSecondary}`}>
          Quiz settings
        </Link>
      </div>

      {/* ------------------------------------------------------------------ summary */}
      <section aria-label="Summary" className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Finished</span>
          <span className={styles.statValue}>
            {summary.finished} <span className={styles.subtle}>of {summary.enrolled}</span>
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>In progress</span>
          <span className={styles.statValue}>{summary.inProgress}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Not started</span>
          <span className={styles.statValue}>{summary.notStarted}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Average</span>
          <span className={styles.statValue}>{summary.average === null ? "—" : pct(summary.average)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Highest</span>
          <span className={styles.statValue}>{summary.highest === null ? "—" : pct(summary.highest)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Lowest</span>
          <span className={styles.statValue}>{summary.lowest === null ? "—" : pct(summary.lowest)}</span>
        </div>
      </section>

      {/* -------------------------------------------------------------------- table */}
      <section className={styles.section} aria-labelledby="students">
        <div className={styles.toolbar}>
          <h2 id="students" style={{ marginBottom: 0 }}>
            Students
          </h2>
          <div className={styles.sortLinks}>
            Sort by
            <Link href={base} aria-current={sort === "name" ? "true" : undefined}>
              Name
            </Link>
            <Link href={`${base}?sort=score`} aria-current={sort === "score" ? "true" : undefined}>
              Score
            </Link>
          </div>
        </div>
        <p className={styles.subtle} style={{ marginBottom: 10 }}>
          A student&rsquo;s result is their <strong>latest finished attempt</strong>. Open a row to see
          every answer.
        </p>

        {rows.length === 0 ? (
          <EmptyState title="No students in this class yet">
            Students join with the class code on the Classes page.
          </EmptyState>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Result</th>
                  <th scope="col">Handed in</th>
                  <th scope="col">Time away</th>
                  <th scope="col">
                    <span style={{ position: "absolute", left: -9999 }}>Review</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.studentId}>
                    <td>
                      {row.name}
                      {!row.enrolled ? <span className={styles.tag}>left class</span> : null}
                      <div className={styles.subtle}>{row.email}</div>
                    </td>
                    <td>{STATE_TEXT[row.state]}</td>
                    <td className={styles.numeric}>
                      {row.attemptsUsed} of {quiz.maxAttempts}
                    </td>
                    <td className={styles.numeric}>
                      {row.latest ? (
                        <>
                          <strong>{score(row.latest.score, row.latest.maxScore)}</strong>{" "}
                          <span className={styles.subtle}>{pct(row.latest.percent)}</span>
                          {row.attemptsUsed > 1 ? (
                            <div className={styles.subtle}>attempt {row.latest.attemptNo}</div>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {row.latest?.submittedAt ? (
                        <>
                          <LocalDateTime iso={row.latest.submittedAt.toISOString()} />
                          {row.latest.timedOut ? <div className={styles.subtle}>time ran out</div> : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={styles.numeric}>
                      {row.away === null ? (
                        "—"
                      ) : !row.away.tracked ? (
                        <span className={styles.subtle} title="Started before time away was recorded">
                          Not recorded
                        </span>
                      ) : row.away.count === 0 ? (
                        <span className={styles.subtle}>None</span>
                      ) : (
                        <>
                          <strong>{row.away.count}×</strong>{" "}
                          <span className={styles.subtle}>{formatAway(row.away.totalMs)}</span>
                        </>
                      )}
                    </td>
                    <td>
                      {row.latest ? (
                        <Link href={`${base}/attempts/${row.latest.attemptId}`}>Review</Link>
                      ) : row.openAttemptId ? (
                        <Link href={`${base}/attempts/${row.openAttemptId}`}>View</Link>
                      ) : null}
                      {row.attemptsUsed > 0 ? (
                        <details className={styles.details} style={{ marginTop: 6, minWidth: 220 }}>
                          <summary>Delete result…</summary>
                          <p>
                            Permanently deletes {row.attemptsUsed === 1 ? "the attempt" : `all ${row.attemptsUsed} attempts`}{" "}
                            and every answer of {row.name} on this quiz. This cannot be undone.
                            They can take the quiz again if it is open.
                          </p>
                          <ActionForm action={deleteStudentResultAction.bind(null, quiz.id, row.studentId)}>
                            <SubmitButton variant="danger" small pendingLabel="Deleting…">
                              Yes, delete
                            </SubmitButton>
                          </ActionForm>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- questions */}
      <section className={styles.section} aria-labelledby="analysis">
        <h2 id="analysis">Question analysis</h2>
        <p className={styles.subtle} style={{ marginBottom: 10 }}>
          Measured over each student&rsquo;s result ({summary.finished}{" "}
          {summary.finished === 1 ? "student" : "students"}). The questions students found hardest have
          the shortest bars.
        </p>
        {summary.finished === 0 ? (
          <EmptyState title="No finished attempts yet">
            The analysis appears once at least one student has finished.
          </EmptyState>
        ) : (
          <ol className={styles.questions}>
            {questions.map((s, index) => (
              <li key={s.itemId} className={styles.question}>
                <div className={styles.questionHead}>
                  <strong>Question {index + 1}</strong>
                  <span>{QUESTION_TYPE_LABELS[s.type]}</span>
                  <span>
                    {num(s.points)} {s.points === 1 ? "point" : "points"}
                  </span>
                </div>
                <p className={styles.prompt}>{s.prompt}</p>

                <div className={styles.analysis}>
                  <Meter percent={s.percentCorrect} />
                  <span className={styles.numeric}>
                    <strong>{s.percentCorrect === null ? "—" : pct(s.percentCorrect)}</strong> correct ·{" "}
                    {s.correct} of {s.basis} students · {s.answered} answered
                  </span>
                </div>

                {s.options.length > 0 ? (
                  <ul className={styles.optionRows} aria-label="How many chose each option">
                    {s.options.map((o) => (
                      <li key={o.text} className={styles.optionRow2}>
                        <span className={styles.optionText} data-correct={o.isCorrect}>
                          {o.isCorrect ? "✓ " : ""}
                          {o.text}
                          <Meter percent={s.basis ? (o.count / s.basis) * 100 : 0} />
                        </span>
                        <span className={styles.count}>{o.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {s.type === "short_answer" && s.commonWrong.length > 0 ? (
                  <div>
                    <p className={styles.subtle}>Most common wrong answers</p>
                    <ul className={styles.optionRows}>
                      {s.commonWrong.map((w) => (
                        <li key={w.text} className={styles.optionRow2}>
                          <span className={styles.optionText}>{w.text}</span>
                          <span className={styles.count}>{w.count}</span>
                        </li>
                      ))}
                    </ul>
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
