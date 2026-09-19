"use client";

import { useState, useSyncExternalStore } from "react";
import styles from "@/components/admin/admin.module.css";

const subscribe = () => () => {};

/**
 * The full registration link for a class, with a Copy button. The site's address is only known in
 * the browser, so the link is filled in after hydration.
 */
export function JoinLink({ code }: { code: string }) {
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);
  const link = origin ? `${origin}/register?code=${code}` : "";

  return (
    <div className={styles.formActions}>
      <input
        className={styles.input}
        style={{ maxWidth: 420 }}
        readOnly
        value={link}
        aria-label="Registration link"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        disabled={!link}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard can be blocked; the link stays selectable in the box.
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
