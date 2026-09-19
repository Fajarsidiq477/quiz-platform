import { requireUser } from "@/auth/dal";
import { SignOutButton } from "@/components/sign-out-button";

export default async function StudentHome() {
  const user = await requireUser("student");
  return (
    <main className="shell">
      <div className="card">
        <h1>Student</h1>
        <p>
          Signed in as {user.name} ({user.email}).
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
