import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { Banner } from "@/components/admin/banner";
import { ClassForm } from "@/components/admin/classes/class-form";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createClassAction } from "@/features/classes/actions";
import { formatJoinCode } from "@/features/classes/join-code";
import { listClasses } from "@/features/classes/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Classes" };

export default async function ClassesPage({ searchParams }: PageProps<"/admin/classes">) {
  const user = await requireUser("admin");
  const [classes, { notice }] = await Promise.all([
    listClasses(getDb(), user.schoolId),
    searchParams,
  ]);

  return (
    <>
      <PageHeader title="Classes" description="Every quiz belongs to a class." />
      <Banner code={notice} />

      <section className={styles.section} aria-labelledby="new-class">
        <h2 id="new-class">New class</h2>
        <ClassForm action={createClassAction} submitLabel="Create class" />
      </section>

      <section className={styles.section} aria-labelledby="all-classes">
        <h2 id="all-classes">Your classes</h2>
        {classes.length === 0 ? (
          <EmptyState title="No classes yet">Create your first class above.</EmptyState>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Term</th>
                  <th scope="col">Students</th>
                  <th scope="col">Quizzes</th>
                  <th scope="col">Join code</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/classes/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.term}</td>
                    <td>{c.studentCount}</td>
                    <td>{c.quizCount}</td>
                    <td>{c.joinCode ? formatJoinCode(c.joinCode) : "Off"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
