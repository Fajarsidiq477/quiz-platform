import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { Banner } from "@/components/admin/banner";
import { EmptyState } from "@/components/admin/empty-state";
import { LocalDateTime } from "@/components/admin/local-datetime";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { listClasses } from "@/features/classes/service";
import { listQuizzes } from "@/features/quizzes/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Quizzes" };

export default async function QuizzesPage({ searchParams }: PageProps<"/admin/quizzes">) {
  const user = await requireUser("admin");
  const [quizzes, classes, { notice }] = await Promise.all([
    listQuizzes(getDb(), user.schoolId),
    listClasses(getDb(), user.schoolId),
    searchParams,
  ]);

  return (
    <>
      <PageHeader title="Quizzes" description="Create quizzes and manage their questions." />
      <Banner code={notice} />

      <div className={styles.toolbar}>
        <span className="muted">
          {quizzes.length} {quizzes.length === 1 ? "quiz" : "quizzes"}
        </span>
        {classes.length > 0 ? (
          <Link href="/admin/quizzes/new" className={styles.btn}>
            New quiz
          </Link>
        ) : null}
      </div>

      {classes.length === 0 ? (
        <EmptyState title="Create a class first">
          Every quiz belongs to a class. <Link href="/admin/classes">Go to Classes</Link> to add one.
        </EmptyState>
      ) : quizzes.length === 0 ? (
        <EmptyState title="No quizzes yet">Use “New quiz” to create your first one.</EmptyState>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Quiz</th>
                <th scope="col">Class</th>
                <th scope="col">Status</th>
                <th scope="col">Questions</th>
                <th scope="col">Opens</th>
                <th scope="col">Closes</th>
              </tr>
            </thead>
            <tbody>
              {quizzes.map((q) => (
                <tr key={q.id}>
                  <td>
                    <Link href={`/admin/quizzes/${q.id}`}>{q.title}</Link>
                  </td>
                  <td>{q.className}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td>{q.questionCount}</td>
                  <td>
                    <LocalDateTime iso={q.opensAt?.toISOString() ?? null} />
                  </td>
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
