import { getCurrentUser } from "@/auth/dal";
import { SignOutButton } from "@/components/sign-out-button";
import styles from "./admin.module.css";

/**
 * Shown in the layout header. This is display only: it renders nothing without a valid user, and
 * the access check itself is `requireUser("admin")` in every page (a layout does not re-run on
 * client navigation and cannot stop its child routes from rendering).
 */
export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <div className={styles.userMenu}>
      <span className={styles.userName}>
        <strong>{user.name}</strong>
        <span className="muted">{user.email}</span>
      </span>
      <SignOutButton />
    </div>
  );
}
