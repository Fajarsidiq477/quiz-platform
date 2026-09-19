import styles from "./admin.module.css";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className={styles.pageHeader}>
      <h1>{title}</h1>
      {description ? <p className="muted">{description}</p> : null}
    </header>
  );
}
