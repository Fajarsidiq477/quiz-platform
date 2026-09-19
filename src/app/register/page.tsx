import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/auth/dal";
import { homeFor } from "@/auth/roles";
import { RegisterForm } from "@/components/register/register-form";

export const metadata: Metadata = { title: "Create account · Quiz Platform" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  // Someone already signed in has no reason to register.
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  // A teacher can share a link like /register?code=K7M2X9QP. It only pre-fills the box; the
  // value is untrusted text and is checked again on the server.
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.slice(0, 20) : "";

  return (
    <main className="shell">
      <RegisterForm initialCode={initialCode} />
    </main>
  );
}
