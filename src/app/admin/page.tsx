import { requireUser } from "@/auth/dal";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AdminHome() {
  const user = await requireUser("admin");
  return (
    <main className="shell">
      <div className="card">
        <h1>Admin</h1>
        <p>
          Signed in as {user.name} ({user.email}).
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
