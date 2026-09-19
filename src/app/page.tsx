import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/dal";
import { homeFor } from "@/auth/roles";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user.role) : "/login");
}
