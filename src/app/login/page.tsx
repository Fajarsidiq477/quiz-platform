import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getCurrentUser } from "@/auth/dal";
import { loginSchema } from "@/auth/password";
import { homeFor } from "@/auth/roles";

const MESSAGES: Record<string, string> = {
  invalid_credentials:
    "Invalid email or password, or the account is disabled or temporarily locked. Ask your admin if you need help.",
  session_ended: "Your session has ended. Please sign in again.",
};

async function signInAction(formData: FormData) {
  "use server";
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid_credentials");

  try {
    await signIn("credentials", { ...parsed.data, redirectTo: "/" });
  } catch (error) {
    // A successful sign-in redirects by throwing, which must be passed on untouched.
    if (error instanceof AuthError) redirect("/login?error=invalid_credentials");
    throw error;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  const { error, notice } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  const justRegistered = (Array.isArray(notice) ? notice[0] : notice) === "registered";

  return (
    <main className="shell">
      <form className="card" action={signInAction}>
        <h1>Quiz Platform</h1>
        <p className="muted">Sign in with your school email and password.</p>
        {justRegistered ? (
          <p className="info" role="status">
            Your account is ready. Please sign in.
          </p>
        ) : null}
        {code ? (
          <p className="notice" role="alert">
            {MESSAGES[code] ?? MESSAGES.invalid_credentials}
          </p>
        ) : null}
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
          />
        </label>
        <button type="submit" className="button">
          Sign in
        </button>
        <p className="muted">
          New student? <Link href="/register">Create an account</Link> with your class code.
        </p>
      </form>
    </main>
  );
}
