import type { Metadata } from "next";
import { requireUser } from "@/auth/dal";
import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";

export const metadata: Metadata = { title: "Classes" };

export default async function ClassesPage() {
  await requireUser("admin");

  return (
    <>
      <PageHeader title="Classes" description="Manage classes and their enrolments." />
      <EmptyState title="Coming soon">This section has not been built yet.</EmptyState>
    </>
  );
}
