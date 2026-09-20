import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { EmptyState } from "@/components/admin/empty-state";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { PageHeader } from "@/components/admin/page-header";
import { pct } from "@/components/admin/results/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { ctxOf } from "@/features/action-helpers";
import { listResultQuizzes } from "@/features/results/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage() {
  const user = await requireUser("admin");
  const quizzes = await listResultQuizzes(getDb(), ctxOf(user));

  return (
    <>
      <PageHeader
        title="Results"
        description="How each class did. Open a quiz to see every student, question by question."
      />

      {quizzes.length === 0 ? (
        <EmptyState title="No results yet">
          Results appear here once a quiz is published.{" "}
          <Link href="/admin/quizzes">Go to Quizzes</Link>
        </EmptyState>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Quiz</th>
                <th scope="col">Class</th>
                <th scope="col">Status</th>
                <th scope="col">Finished</th>
                <th scope="col">In progress</th>
                <th scope="col">Average</th>
                <th scope="col">Closes</th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link href={`/admin/results/${q.id}`}>{q.title}</Link>
                  </td>
                  <td>{q.className}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td className={styles.numeric}>
                    {q.finished} of {q.enrolled}
                  </td>
                  <td className={styles.numeric}>{q.inProgress}</td>
                  <td className={styles.numeric}>{q.average === null ? "—" : pct(q.average)}</td>
                  <td>
                    <LocalDateTime iso={q.closesAt?.toISOString() ?? null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
