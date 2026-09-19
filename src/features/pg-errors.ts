type PgLike = { code?: unknown; constraint?: unknown; message?: unknown };

/** Finds the Postgres error inside a wrapped error (Drizzle wraps driver errors in `cause`). */
function pgError(err: unknown): PgLike | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const e = cur as PgLike & { cause?: unknown };
    if (typeof e.code === "string" && e.code.length === 5) return e;
    cur = e.cause;
  }
  return null;
}

/** True for a unique-constraint violation, optionally on one named constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  if (!e || e.code !== "23505") return false;
  if (!constraint) return true;
  return e.constraint === constraint || String(e.message ?? "").includes(constraint);
}
