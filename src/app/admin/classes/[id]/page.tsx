import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/auth/dal";
import { getDb } from "@/db";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Banner } from "@/components/admin/banner";
import { ClassForm } from "@/components/admin/classes/class-form";
import { JoinLink } from "@/components/admin/classes/join-link";
import { PageHeader } from "@/components/admin/page-header";
import {
  deleteClassAction,
  disableJoinCodeAction,
  generateJoinCodeAction,
  updateClassAction,
} from "@/features/classes/actions";
import { formatJoinCode } from "@/features/classes/join-code";
import { getClass } from "@/features/classes/service";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = { title: "Edit class" };

export default async function EditClassPage({
  params,
  searchParams,
}: PageProps<"/admin/classes/[id]">) {
  const user = await requireUser("admin");
  const { id } = await params;
  const { notice } = await searchParams;
  const found = await getClass(getDb(), user.schoolId, id);
  if (!found) notFound();

  return (
    <>
      <p className={styles.backLink}>
        <Link href="/admin/classes">← All classes</Link>
      </p>
      <PageHeader
        title={found.name}
        description={`Term ${found.term} · ${found.studentCount} ${found.studentCount === 1 ? "student" : "students"} enrolled`}
      />
      <Banner code={notice} />

      <section className={styles.section} aria-labelledby="class-details">
        <h2 id="class-details">Details</h2>
        <ClassForm
          action={updateClassAction.bind(null, found.id)}
          initial={{ name: found.name, term: found.term }}
          submitLabel="Save changes"
          cancelHref="/admin/classes"
        />
      </section>

      <section className={styles.section} aria-labelledby="class-registration">
        <h2 id="class-registration">Student registration</h2>
        {found.joinCode ? (
          <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <p>
              Give students this code. They go to <strong>/register</strong>, enter it with their
              name, email and a password, and are added to this class automatically.
            </p>
            <p className={styles.code} aria-label="Class code">
              {formatJoinCode(found.joinCode)}
            </p>
            <JoinLink code={found.joinCode} />
            <div className={styles.rowActions}>
              <ActionForm action={generateJoinCodeAction.bind(null, found.id)}>
                <SubmitButton variant="secondary">Generate a new code</SubmitButton>
              </ActionForm>
              <ActionForm action={disableJoinCodeAction.bind(null, found.id)}>
                <SubmitButton variant="secondary">Turn off registration</SubmitButton>
              </ActionForm>
            </div>
            <p className="muted">
              A new code stops the old one working straight away. Students already registered are
              not affected.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <p>
              Registration is <strong>off</strong>: nobody can sign themselves up for this class.
            </p>
            <ActionForm action={generateJoinCodeAction.bind(null, found.id)}>
              <SubmitButton pendingLabel="Turning on…">Turn on registration</SubmitButton>
            </ActionForm>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="delete-class">
        <h2 id="delete-class">Delete class</h2>
        <details className={styles.details}>
          <summary>Delete this class…</summary>
          <p>
            An unused class is deleted. If it already has quizzes or students, it is hidden instead
            and they are kept.
          </p>
          <ActionForm action={deleteClassAction.bind(null, found.id)}>
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Yes, delete this class
            </SubmitButton>
          </ActionForm>
        </details>
      </section>
    </>
  );
}
