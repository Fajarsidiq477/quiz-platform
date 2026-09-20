"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/admin/action-form";
import { DateTimeField } from "@/components/admin/datetime-field";
import { Field } from "@/components/admin/field";
import type { FormState } from "@/features/form-state";
import styles from "@/components/admin/admin.module.css";

export type QuizRulesValues = {
  title: string;
  description: string;
  /** ISO instants. */
  opensAt: string | null;
  closesAt: string | null;
  maxAttempts: number;
  shuffleQuestions: boolean;
  resultsVisibility: "never" | "after_submit" | "after_close";
};

/**
 * The part of a quiz that can still change once students have attempted it. The class, the time
 * limit and the questions are not offered here: the database keeps them fixed while any result
 * exists.
 */
export function QuizRulesForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial: QuizRulesValues;
  submitLabel: string;
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

      <div className={styles.formRow}>
        <DateTimeField
          name="opensAt"
          label="Opens"
          initialIso={initial.opensAt}
          error={errors.opensAt}
          hint="Shown in your local time."
        />
        <DateTimeField
          name="closesAt"
          label="Closes"
          initialIso={initial.closesAt}
          error={errors.closesAt}
          hint="Students can start until this time. To reopen, choose a time in the future."
        />
      </div>

      <Field
        label="Attempts allowed"
        error={errors.maxAttempts}
        hint="A student who has used every attempt can only start again if you raise this or delete their result."
      >
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
      </div>
    </form>
  );
}
