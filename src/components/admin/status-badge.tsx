import styles from "./admin.module.css";

const LABELS = { draft: "Draft", published: "Published", closed: "Closed" } as const;

export function StatusBadge({ status }: { status: keyof typeof LABELS }) {
  return <span className={`${styles.badge} ${styles[`badge_${status}`] ?? ""}`}>{LABELS[status]}</span>;
}
