"use client";

import styles from "./student.module.css";

/** Where a question stands, as the student sees it. */
export type NavStatus = "answered" | "unanswered" | "unsaved";

export type NavEntry = { id: string; number: number; status: NavStatus };

const STATUS_TEXT: Record<NavStatus, string> = {
  answered: "answered",
  unanswered: "not answered yet",
  unsaved: "answered, but not saved yet",
};

/**
 * The question navigator: one numbered button per question, marked answered or not, that jumps to
 * that question. A sidebar on wide screens and a strip under the timer on phones (the layout is CSS
 * only, so there is one list). Status is never colour alone: answered buttons carry a tick, and
 * every button says its status to a screen reader.
 */
export function QuestionNav({
  entries,
  currentId,
  onGo,
}: {
  entries: NavEntry[];
  currentId: string | null;
  onGo: (id: string) => void;
}) {
  const answered = entries.filter((e) => e.status !== "unanswered").length;
  return (
    <nav className={styles.navPanel} aria-label="Question navigator">
      <div className={styles.navHead}>
        <span className={styles.navTitle}>Questions</span>
        <span className={styles.navSummary}>
          {answered} of {entries.length} answered
        </span>
      </div>
      <ol className={styles.navGrid}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className={styles.navItem}
              data-status={entry.status}
              aria-current={entry.id === currentId ? "true" : undefined}
              aria-label={`Question ${entry.number}, ${STATUS_TEXT[entry.status]}`}
              onClick={() => onGo(entry.id)}
            >
              {entry.number}
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.navLegend} aria-hidden="true">
        <span>
          <i className={styles.navKey} data-status="answered" /> Answered
        </span>
        <span>
          <i className={styles.navKey} data-status="unanswered" /> Not yet
        </span>
      </div>
    </nav>
  );
}
