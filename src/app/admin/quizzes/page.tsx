import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Quizzes" };

export default async function QuizzesPage() {
  await requireUser("admin");

  return (
    <>
      <PageHeader title="Quizzes" description="Create quizzes and review results." />
      <EmptyState title="Coming soon">This section has not been built yet.</EmptyState>
    </>
  );
}
