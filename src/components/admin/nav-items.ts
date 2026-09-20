/** Sidebar entries. Each `href` must have a matching page under src/app (enforced by a test). */
export const ADMIN_NAV = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/students", label: "Students" },
  { href: "/admin/questions", label: "Question bank" },
  { href: "/admin/quizzes", label: "Quizzes" },
  { href: "/admin/results", label: "Results" },
] as const;

export type AdminNavItem = (typeof ADMIN_NAV)[number];

/** `/admin` only matches itself; other entries also match their sub-pages. */
export function isActive(item: { href: string; exact?: boolean }, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
