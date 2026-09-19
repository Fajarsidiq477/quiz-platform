import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import styles from "@/components/admin/admin.module.css";

// The layout's title template only applies to child segments, not to this page beside it.
export const metadata: Metadata = { title: { absolute: "Dashboard · Admin · Quiz Platform" } };

// Placeholder figures: nothing is counted yet, so no numbers are shown.
const STATS = ["Classes", "Students", "Questions", "Quizzes"] as const;

export default async function AdminDashboard() {
  const user = await requireUser("admin");

  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome back, ${user.name}.`} />

      <section aria-label="Overview" className={styles.stats}>
        {STATS.map((label) => (
          <div key={label} className={styles.stat}>
            <span className={styles.statLabel}>{label}</span>
            <span className={styles.statValue} aria-label="No data yet">
              —
            </span>
          </div>
        ))}
      </section>

      <section className={styles.panel} aria-labelledby="recent-activity">
        <h2 id="recent-activity">Recent activity</h2>
        <EmptyState title="No activity yet">
          Quiz attempts and submissions will show up here.
        </EmptyState>
      </section>
    </>
  );
}
