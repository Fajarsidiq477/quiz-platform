import { and, eq, isNull, sql } from "drizzle-orm";
import { attemptAwayPeriods, type AwayReason } from "@/db/schema";
import { withSchool } from "@/db/tenant";
import type { AnyPgDb } from "@/db/types";
import { ServiceError, type Ctx } from "../errors";
import { GRACE_MS, loadOwnAttempt } from "./service";

// Leaving the quiz page is recorded. The browser only says "I left" and "I am back"; the moments
// come from the database clock (a trigger sets them), so a student cannot send a shorter absence.
// Both reports are idempotent, so a retry or a double report changes nothing.

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * The student left the page. Starts an away period unless one is already open. Refused once the
 * attempt is over (nothing to record, and the browser stops reporting).
 */
export async function reportAway(db: AnyPgDb, ctx: Ctx, attemptId: string, reason: AwayReason) {
  if (!isUuid(attemptId)) throw new ServiceError("Attempt not found", "not_found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    // Locked like a save or a submit, so it cannot interleave with the attempt being handed in.
    const { attempt, remainingMs } = await loadOwnAttempt(tx, ctx, attemptId, true);
    if (attempt.status !== "in_progress" || remainingMs < -GRACE_MS) {
      throw new ServiceError("This attempt is closed", "invalid_state");
    }
    await tx
      .insert(attemptAwayPeriods)
      .values({ schoolId: ctx.schoolId, attemptId: attempt.id, reason })
      .onConflictDoNothing({
        target: attemptAwayPeriods.attemptId,
        where: sql`${attemptAwayPeriods.endedAt} is null`,
      });
  });
}

/**
 * The student is back. Ends the open away period, if any. Harmless when there is none or when the
 * attempt is already over (it may have been handed in while away); readers cap a period at the
 * moment the attempt ended.
 */
export async function reportBack(db: AnyPgDb, ctx: Ctx, attemptId: string) {
  if (!isUuid(attemptId)) throw new ServiceError("Attempt not found", "not_found");
  await withSchool(db, ctx.schoolId, async (tx) => {
    const { attempt } = await loadOwnAttempt(tx, ctx, attemptId, true);
    await tx
      .update(attemptAwayPeriods)
      .set({ endedAt: sql`now()` })
      .where(
        and(
          eq(attemptAwayPeriods.attemptId, attempt.id),
          eq(attemptAwayPeriods.schoolId, ctx.schoolId),
          isNull(attemptAwayPeriods.endedAt),
        ),
      );
  });
}
