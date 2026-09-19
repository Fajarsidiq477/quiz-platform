"use client";

import { useState, useSyncExternalStore } from "react";
import { isoToLocalInput, localInputToIso } from "./date-utils";
import styles from "./admin.module.css";

const subscribe = () => () => {};

/**
 * A date-and-time input that submits an ISO instant under `name`. The visible input has no name;
 * a hidden one carries the converted value, so the server never has to guess a time zone.
 */
export function DateTimeField({
  name,
  label,
  initialIso,
  error,
  hint,
}: {
  name: string;
  label: string;
  initialIso: string | null;
  error?: string;
  hint?: string;
}) {
  // The starting value depends on the browser's time zone, so it is read after hydration.
  const initial = useSyncExternalStore(
    subscribe,
    () => isoToLocalInput(initialIso),
    () => "",
  );
  const [edited, setEdited] = useState<string | null>(null);
  const value = edited ?? initial;

  return (
    <label className={styles.field}>
      {label}
      <input
        type="datetime-local"
        className={styles.input}
        value={value}
        onChange={(e) => setEdited(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      <input type="hidden" name={name} value={localInputToIso(value)} />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
