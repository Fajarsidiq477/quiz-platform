import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { UserMenu } from "@/components/admin/user-menu";
import styles from "@/components/admin/admin.module.css";

export const metadata: Metadata = {
  title: { template: "%s · Admin · Quiz Platform", default: "Admin · Quiz Platform" },
};

// Presentation only. It does NOT check access: a layout does not re-run on client-side navigation
// and cannot stop child routes from rendering. Every page under /admin must call
// requireUser("admin") itself (tests/admin/pages-are-protected.test.ts enforces this).
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.brand}>
          Quiz Platform<span>Admin</span>
        </div>
        {/* Streamed separately so the shell does not wait on the user lookup. */}
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </header>
      <aside className={styles.sidebar}>
        <AdminNav />
      </aside>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
