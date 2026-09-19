"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/admin/action-form";
import { Field } from "@/components/admin/field";
import type { FormState } from "@/features/form-state";
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type QuestionType } from "@/features/quizzes/schemas";
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  addOption,
  buildPayload,
  emptyDraft,
  removeOption,
  selectOnly,
  toggleCorrect,
  withType,
  type QuestionDraft,
} from "./question-draft";
import styles from "@/components/admin/admin.module.css";

export function QuestionForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial?: QuestionDraft;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const [draft, setDraft] = useState<QuestionDraft>(initial ?? emptyDraft());
  const errors = state?.fieldErrors ?? {};
  const update = (patch: Partial<QuestionDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const isChoice = draft.type === "single_choice" || draft.type === "multiple_choice";
  const single = draft.type === "single_choice";

  return (
    <form action={formAction} className={styles.form}>
      {state?.error ? (
        <p className={styles.errorBanner} role="alert">
          {state.error}
        </p>
      ) : null}

      {/* The visible controls have no names: the whole question travels as one JSON field. */}
      <input type="hidden" name="payload" value={JSON.stringify(buildPayload(draft))} />

      <div className={styles.formRow}>
        <Field label="Question type">
          <select
            className={styles.input}
            value={draft.type}
            onChange={(e) => setDraft((d) => withType(d, e.target.value as QuestionType))}
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Points" error={errors.points}>
          <input
            type="number"
            min={0}
            max={1000}
            step="any"
            className={styles.input}
            value={draft.points}
            onChange={(e) => update({ points: e.target.value })}
          />
        </Field>
      </div>

      <Field label="Question" error={errors.prompt}>
        <textarea
          className={styles.input}
          value={draft.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          maxLength={5000}
          required
        />
      </Field>

      {isChoice ? (
        <fieldset className={styles.fieldset}>
          <legend>
            Options — {single ? "select the one correct answer" : "tick every correct answer"}
          </legend>
          {draft.options.map((option, index) => (
            <div key={index} className={styles.optionRow}>
              <input
                type={single ? "radio" : "checkbox"}
                name={single ? "correct-option" : undefined}
                checked={option.isCorrect}
                onChange={() =>
                  setDraft((d) => (single ? selectOnly(d, index) : toggleCorrect(d, index)))
                }
                aria-label={`Option ${index + 1} is correct`}
              />
              <input
                className={styles.input}
                value={option.text}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    options: d.options.map((o, i) =>
                      i === index ? { ...o, text: e.target.value } : o,
                    ),
                  }))
                }
                placeholder={`Option ${index + 1}`}
                maxLength={500}
                aria-label={`Option ${index + 1} text`}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                onClick={() => setDraft((d) => removeOption(d, index))}
                disabled={draft.options.length <= MIN_OPTIONS}
                aria-label={`Remove option ${index + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          {errors.options ? (
            <span className={styles.fieldError} role="alert">
              {errors.options}
            </span>
          ) : null}
          <div>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
              onClick={() => setDraft(addOption)}
              disabled={draft.options.length >= MAX_OPTIONS}
            >
              Add option
            </button>
          </div>
        </fieldset>
      ) : null}

      {draft.type === "true_false" ? (
        <fieldset className={styles.fieldset}>
          <legend>Correct answer</legend>
          <label className={styles.checkbox}>
            <input
              type="radio"
              name="tf"
              checked={draft.trueFalseCorrect}
              onChange={() => update({ trueFalseCorrect: true })}
            />
            True
          </label>
          <label className={styles.checkbox}>
            <input
              type="radio"
              name="tf"
              checked={!draft.trueFalseCorrect}
              onChange={() => update({ trueFalseCorrect: false })}
            />
            False
          </label>
        </fieldset>
      ) : null}

      {draft.type === "short_answer" ? (
        <Field
          label="Accepted answers"
          error={errors.acceptedAnswers}
          hint="One answer per line. Any of them counts as correct."
        >
          <textarea
            className={styles.input}
            value={draft.acceptedAnswers}
            onChange={(e) => update({ acceptedAnswers: e.target.value })}
          />
        </Field>
      ) : null}

      <Field
        label="Explanation (optional)"
        error={errors.explanation}
        hint="Shown to students with their results."
      >
        <textarea
          className={styles.input}
          value={draft.explanation}
          onChange={(e) => update({ explanation: e.target.value })}
          maxLength={2000}
        />
      </Field>

      <div className={styles.formActions}>
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <Link href={cancelHref} className={`${styles.btn} ${styles.btnSecondary}`}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
