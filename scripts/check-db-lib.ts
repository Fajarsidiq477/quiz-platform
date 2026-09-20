// Judging a database connection for the web app. Pure, so it is unit-tested; `check-db.ts` does the
// querying and printing.

export type RoleInfo = { name: string; superuser: boolean; bypassRls: boolean };

export type DbCheck = { ok: boolean; problems: string[]; notes: string[] };

/**
 * The web app's connection must NOT be able to skip row-level security, or every school could read
 * every other school's data. `visibleUsers` is how many rows of `users` the connection can see when
 * no school has been selected: with row-level security working that is 0.
 */
export function assessRole(
  role: RoleInfo,
  visibleUsers: number | null,
  tablesExist: boolean,
): DbCheck {
  const problems: string[] = [];
  const notes: string[] = [];

  if (!tablesExist) {
    problems.push("The tables do not exist yet. Run `npm run db:migrate` (with the owner connection) first.");
    return { ok: false, problems, notes };
  }
  if (role.superuser) {
    problems.push(
      `"${role.name}" is a superuser, which ignores row-level security: schools are NOT kept apart. Use a limited role (docs/neon-app-role.sql).`,
    );
  }
  if (role.bypassRls && !role.superuser) {
    // (A superuser always bypasses too; that is already said above.)
    problems.push(
      `"${role.name}" has BYPASSRLS, which ignores row-level security: schools are NOT kept apart. Roles created in the Neon console get it; create the app role with SQL instead (docs/neon-app-role.sql).`,
    );
  }
  if (!role.superuser && !role.bypassRls) {
    if (visibleUsers === null) {
      notes.push("Could not count users (the role has no access to the tables). Check the grants in docs/neon-app-role.sql.");
      problems.push("The role cannot read the tables. Run the grants in docs/neon-app-role.sql.");
    } else if (visibleUsers > 0) {
      problems.push(
        `The role can see ${visibleUsers} user row(s) without a school selected: row-level security is not working.`,
      );
    }
  } else if (visibleUsers !== null && visibleUsers > 0) {
    notes.push(`It can see ${visibleUsers} user row(s) across schools, as expected for a role that bypasses row-level security.`);
  }
  return { ok: problems.length === 0, problems, notes };
}
