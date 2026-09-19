"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import type { FormState } from "@/features/form-state";
import styles from "@/components/admin/admin.module.css";

export function ClassForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial?: { name: string; term: string };
  submitLabel: string;
  cancelHref?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className={styles.form}>
      {state?.error ? (
        <p className={styles.errorBanner} role="alert">
          {state.error}
        </p>
      ) : null}
      <div className={styles.formRow}>
        <Field label="Class name" error={errors.name}>
          <input
            name="name"
            className={styles.input}
            defaultValue={initial?.name ?? ""}
            placeholder="e.g. ICT 10A"
            maxLength={100}
            required
          />
        </Field>
        <Field label="Term" error={errors.term} hint="e.g. 2026-1 or Semester 1">
          <input
            name="term"
            className={styles.input}
            defaultValue={initial?.term ?? ""}
            maxLength={50}
            required
          />
        </Field>
      </div>
      <div className={styles.formActions}>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        {cancelHref ? (
          <Link href={cancelHref} className={`${styles.btn} ${styles.btnSecondary}`}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
