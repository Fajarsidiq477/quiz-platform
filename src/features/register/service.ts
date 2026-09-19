import { and, eq, isNull, sql } from "drizzle-orm";
import { hashPassword } from "@/auth/password";
import { classes, enrollments, users } from "@/db/schema";
import { withSchool } from "@/db/tenant";
import type { AnyPgDb } from "@/db/types";
import { ServiceError } from "../errors";
import { isUniqueViolation } from "../pg-errors";
import type { RegisterInput } from "./schemas";

export type JoinTarget = { classId: string; schoolId: string; className: string };

/**
 * Finds the class a join code belongs to. The student is not signed in and the school is not
 * known yet, so this sets `app.join_code` for the transaction only, which the `join_code_lookup`
 * RLS policy honours: it exposes exactly the class with that code and nothing else.
 */
export async function findClassByJoinCode(db: AnyPgDb, code: string): Promise<JoinTarget | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.join_code', ${code}, true)`);
    const [row] = await tx
      .select({ classId: classes.id, schoolId: classes.schoolId, className: classes.name })
      .from(classes)
      .where(and(eq(classes.joinCode, code), isNull(classes.archivedAt)))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Creates a student account and enrols it in the class the code belongs to. The role is always
 * `student` and the school always comes from the class, never from anything the visitor sends.
 * Both inserts happen in one transaction, so a failure leaves nothing behind.
 */
export async function registerStudent(db: AnyPgDb, input: RegisterInput) {
  const target = await findClassByJoinCode(db, input.code);
  if (!target) {
    throw new ServiceError(
      "That class code is not valid. Check it with your teacher.",
      "not_found",
    );
  }

  // Hashing is slow on purpose, so it only happens once the code is known to be real.
  const passwordHash = await hashPassword(input.password);

  try {
    return await withSchool(db, target.schoolId, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          schoolId: target.schoolId,
          email: input.email,
          name: input.name,
          role: "student",
          status: "active",
          passwordHash,
        })
        .returning({ id: users.id });
      await tx
        .insert(enrollments)
        .values({ schoolId: target.schoolId, classId: target.classId, studentId: user.id });
      return { ...target, userId: user.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_uq")) {
      throw new ServiceError(
        "An account with this email already exists. Try signing in instead.",
        "conflict",
      );
    }
    throw err;
  }
}
