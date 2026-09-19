import styles from "./admin.module.css";

/** A labelled form control with an optional hint and an inline error. */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      {label}
      {children}
      {hint ? <span className={styles.hint}>{hint}</span> : null}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
