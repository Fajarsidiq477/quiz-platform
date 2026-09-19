import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserMenu } from "@/components/admin/user-menu";
import styles from "@/components/student/student.module.css";

export const metadata: Metadata = {
  title: { template: "%s · Quiz Platform", default: "My quizzes · Quiz Platform" },
};

// Presentation only. It does NOT check access: a layout does not re-run on client-side navigation
// and cannot stop child routes from rendering. Every page under /student must call
// requireUser("student") itself (tests/admin/pages-are-protected.test.ts enforces this).
export default function StudentLayout({ children }: LayoutProps<"/student">) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.headerLinks}>
          <Link href="/student" className={styles.brand}>
            Quiz Platform
          </Link>
        </div>
        {/* Streamed separately so the page does not wait on the user lookup. */}
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
