import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Question bank" };

export default async function QuestionBankPage() {
  await requireUser("admin");

  return (
    <>
      <PageHeader title="Question bank" description="Write and version questions." />
      <EmptyState title="Coming soon">This section has not been built yet.</EmptyState>
    </>
  );
}
