"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/admin/action-form";
import { DateTimeField } from "@/components/admin/datetime-field";
import { Field } from "@/components/admin/field";
import type { FormState } from "@/features/form-state";
import styles from "@/components/admin/admin.module.css";

export type QuizFormValues = {
  title: string;
  description: string;
  classId: string;
  timeLimitMinutes: number | null;
  /** ISO instants, or null. */
  opensAt: string | null;
  closesAt: string | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  resultsVisibility: "never" | "after_submit" | "after_close";
};

export const NEW_QUIZ_DEFAULTS: Omit<QuizFormValues, "classId"> = {
  title: "",
  description: "",
  timeLimitMinutes: 30,
  opensAt: null,
  closesAt: null,
  maxAttempts: 1,
  shuffleQuestions: false,
  resultsVisibility: "after_close",
};

export function QuizForm({
  action,
  classes,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  classes: { id: string; name: string; term: string }[];
  initial: QuizFormValues;
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

      <Field label="Title" error={errors.title}>
        <input
          name="title"
          className={styles.input}
          defaultValue={initial.title}
          maxLength={200}
          required
        />
      </Field>

      <Field label="Description (optional)" error={errors.description}>
        <textarea
          name="description"
          className={styles.input}
          defaultValue={initial.description}
          maxLength={2000}
        />
      </Field>

      <Field label="Class" error={errors.classId}>
        <select name="classId" className={styles.input} defaultValue={initial.classId} required>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.term})
            </option>
          ))}
        </select>
      </Field>

      <div className={styles.formRow}>
        <DateTimeField
          name="opensAt"
          label="Opens"
          initialIso={initial.opensAt}
          error={errors.opensAt}
          hint="Required to publish. Shown in your local time."
        />
        <DateTimeField
          name="closesAt"
          label="Closes"
          initialIso={initial.closesAt}
          error={errors.closesAt}
          hint="Required to publish."
        />
      </div>

      <div className={styles.formRow}>
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
            defaultValue={initial.timeLimitMinutes ?? ""}
          />
        </Field>
        <Field label="Attempts allowed" error={errors.maxAttempts}>
          <input
            name="maxAttempts"
            type="number"
            min={1}
            max={20}
            step={1}
            className={styles.input}
            defaultValue={initial.maxAttempts}
            required
          />
        </Field>
      </div>

      <Field label="Show results to students" error={errors.resultsVisibility}>
        <select
          name="resultsVisibility"
          className={styles.input}
          defaultValue={initial.resultsVisibility}
        >
          <option value="after_submit">Right after they submit</option>
          <option value="after_close">After the quiz closes</option>
          <option value="never">Never</option>
        </select>
      </Field>

      <label className={styles.checkbox}>
        <input type="checkbox" name="shuffleQuestions" defaultChecked={initial.shuffleQuestions} />
        Shuffle the question order for each student
      </label>

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
