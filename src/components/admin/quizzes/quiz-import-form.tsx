"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import type { FormState } from "@/features/form-state";
import styles from "@/components/admin/admin.module.css";

/** How many problems to list before pointing at the rest (the server already caps at 50). */
const SHOWN = 20;

export function QuizImportForm({
  action,
  classes,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  classes: { id: string; name: string; term: string }[];
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const errors = state?.fieldErrors ?? {};
  const details = state?.details ?? [];

  return (
    <form action={formAction} className={styles.form}>
      {state?.error ? (
        <div className={styles.errorBanner} role="alert">
          <p>{state.error}</p>
          {details.length > 0 ? (
            <ul style={{ margin: "8px 0 0 18px" }}>
              {details.slice(0, SHOWN).map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
              {details.length > SHOWN ? <li>…and {details.length - SHOWN} more.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Field label="Excel file (.xlsx)" error={errors.file} hint="Up to 2 MB, at most 100 questions.">
        <input name="file" type="file" className={styles.input} accept=".xlsx" required />
      </Field>

      <Field label="Quiz title" error={errors.title}>
        <input name="title" className={styles.input} maxLength={200} required />
      </Field>

      <Field label="Class" error={errors.classId}>
        <select name="classId" className={styles.input} defaultValue={classes[0]?.id} required>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.term})
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Time limit (minutes)"
        error={errors.timeLimitMinutes}
        hint="Leave empty for no time limit; students then have until the closing time."
      >
        <input
          name="timeLimitMinutes"
          type="number"
          min={1}
          max={600}
          step={1}
          className={styles.input}
          defaultValue={30}
        />
      </Field>

      <div className={styles.formActions}>
        <SubmitButton pendingLabel="Importing…">Import quiz</SubmitButton>
        <Link href={cancelHref} className={`${styles.btn} ${styles.btnSecondary}`}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
