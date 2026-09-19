import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { auth } from "./index";
import { homeFor, type SignInRole } from "./roles";
import { loadActiveUser } from "./sign-in-policy";

/**
 * The signed-in user, verified against the database (not just the cookie), or null.
 * Memoised per request. Pages, server actions and route handlers should use this, not `auth()`.
 */
export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user) return null;
  return loadActiveUser(getDb(), {
    uid: session.user.id,
    schoolId: session.user.schoolId,
    role: session.user.role,
  });
});

/** Redirects to sign-in when signed out, or to the user's own home when the role is wrong. */
export async function requireUser(role: SignInRole) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?error=session_ended");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}
