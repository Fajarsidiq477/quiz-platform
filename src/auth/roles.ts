/** Roles that can sign in today. `teacher` exists in the database but has no sign-in yet. */
export const SIGN_IN_ROLES = ["student", "admin"] as const;
export type SignInRole = (typeof SIGN_IN_ROLES)[number];

export function isSignInRole(role: string): role is SignInRole {
  return (SIGN_IN_ROLES as readonly string[]).includes(role);
}

export function homeFor(role: SignInRole): string {
  return role === "admin" ? "/admin" : "/student";
}

/** Which role a path is reserved for, or null if it is public. Used by the proxy and tests. */
export function requiredRoleForPath(pathname: string): SignInRole | null {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/student" || pathname.startsWith("/student/")) return "student";
  return null;
}
