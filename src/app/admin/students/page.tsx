import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage() {
  await requireUser("admin");

  return (
    <>
      <PageHeader title="Students" description="Add and manage student accounts." />
      <EmptyState title="Coming soon">This section has not been built yet.</EmptyState>
    </>
  );
}
