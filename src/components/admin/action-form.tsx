"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/features/form-state";
import styles from "./admin.module.css";

/**
 * A small form around a server action (publish, delete, move...). A failure from the action is
 * shown inline next to the button instead of navigating away.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p className={styles.formError} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  small = false,
  pendingLabel,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  const variantClass =
    variant === "danger" ? styles.btnDanger : variant === "secondary" ? styles.btnSecondary : "";
  return (
    <button
      type="submit"
      className={`${styles.btn} ${variantClass} ${small ? styles.btnSmall : ""}`}
      disabled={pending}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
