import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { classes, enrollments, quizzes } from "@/db/schema";
import { withSchool } from "@/db/tenant";
import type { AnyPgDb } from "@/db/types";
import { ServiceError, type Ctx } from "../errors";
import { isUniqueViolation } from "../pg-errors";
import { generateJoinCode } from "./join-code";
import { classInputSchema, type ClassInput } from "./schemas";
import { z } from "zod";

export type ClassDetail = {
  id: string;
  name: string;
  term: string;
  /** Null = students cannot register into this class. */
  joinCode: string | null;
  /** Students with an active enrolment. */
  studentCount: number;
};

export type ClassRow = ClassDetail & { quizCount: number };

const isUuid = (v: string) => z.uuid().safeParse(v).success;

const DUPLICATE = "A class with this name already exists for that term";

const columns = {
  id: classes.id,
  name: classes.name,
  term: classes.term,
  joinCode: classes.joinCode,
};

// The columns are written out in full inside these subqueries: Drizzle drops the table name in a
// single-table query, and a bare "id" would mean the inner table's own id.
const studentCount = sql<number>`(select count(*)::int from enrollments e
  where e.class_id = "classes"."id" and e.status = 'active')`;
const quizCount = sql<number>`(select count(*)::int from quizzes q
  where q.class_id = "classes"."id" and q.archived_at is null)`;

export async function listClasses(db: AnyPgDb, schoolId: string): Promise<ClassRow[]> {
  return withSchool(db, schoolId, (tx) =>
    tx
      .select({ ...columns, quizCount, studentCount })
      .from(classes)
      .where(and(eq(classes.schoolId, schoolId), isNull(classes.archivedAt)))
      .orderBy(desc(classes.term), asc(classes.name)),
  );
}

export async function getClass(
  db: AnyPgDb,
  schoolId: string,
  id: string,
): Promise<ClassDetail | null> {
  if (!isUuid(id)) return null;
  return withSchool(db, schoolId, async (tx) => {
    const [row] = await tx
      .select({ ...columns, studentCount })
      .from(classes)
      .where(and(eq(classes.id, id), eq(classes.schoolId, schoolId), isNull(classes.archivedAt)))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Turns student self-registration on (a new code, replacing any old one) or off for a class.
 * Returns the new code, or null when turned off. Anyone holding the old code can no longer use it.
 */
export async function setJoinCode(
  db: AnyPgDb,
  ctx: Ctx,
  id: string,
  mode: "generate" | "disable",
): Promise<string | null> {
  if (!isUuid(id)) throw new ServiceError("Class not found", "not_found");

  // Codes are unique across every school, so a clash is possible (if unlikely): try a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = mode === "generate" ? generateJoinCode() : null;
    try {
      return await withSchool(db, ctx.schoolId, async (tx) => {
        const updated = await tx
          .update(classes)
          .set({ joinCode: code })
          .where(
            and(eq(classes.id, id), eq(classes.schoolId, ctx.schoolId), isNull(classes.archivedAt)),
          )
          .returning({ id: classes.id });
        if (updated.length === 0) throw new ServiceError("Class not found", "not_found");
        return code;
      });
    } catch (err) {
      if (mode === "generate" && isUniqueViolation(err, "classes_join_code_uq")) continue;
      throw err;
    }
  }
  throw new ServiceError("Could not create a code. Please try again.", "conflict");
}

export async function createClass(db: AnyPgDb, ctx: Ctx, rawInput: ClassInput) {
  const input = classInputSchema.parse(rawInput);
  try {
    return await withSchool(db, ctx.schoolId, async (tx) => {
      const [row] = await tx
        .insert(classes)
        // The signed-in admin is the class's teacher.
        .values({ schoolId: ctx.schoolId, teacherId: ctx.userId, ...input })
        .returning(columns);
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err, "classes_school_term_name_uq")) {
      throw new ServiceError(DUPLICATE, "conflict");
    }
    throw err;
  }
}

export async function updateClass(db: AnyPgDb, ctx: Ctx, id: string, rawInput: ClassInput) {
  const input = classInputSchema.parse(rawInput);
  if (!isUuid(id)) throw new ServiceError("Class not found", "not_found");
  try {
    return await withSchool(db, ctx.schoolId, async (tx) => {
      const [row] = await tx
        .update(classes)
        .set(input)
        .where(
          and(eq(classes.id, id), eq(classes.schoolId, ctx.schoolId), isNull(classes.archivedAt)),
        )
        .returning(columns);
      if (!row) throw new ServiceError("Class not found", "not_found");
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err, "classes_school_term_name_uq")) {
      throw new ServiceError(DUPLICATE, "conflict");
    }
    throw err;
  }
}

/**
 * Removes the class if nothing refers to it. A class that has quizzes or enrolled students is
 * archived instead (hidden, history kept), because quizzes and attempts must never be lost.
 */
export async function deleteClass(
  db: AnyPgDb,
  ctx: Ctx,
  id: string,
): Promise<"deleted" | "archived"> {
  if (!isUuid(id)) throw new ServiceError("Class not found", "not_found");
  return withSchool(db, ctx.schoolId, async (tx) => {
    const [existing] = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(
        and(eq(classes.id, id), eq(classes.schoolId, ctx.schoolId), isNull(classes.archivedAt)),
      )
      .limit(1);
    if (!existing) throw new ServiceError("Class not found", "not_found");

    const [{ n: quizCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(quizzes)
      .where(and(eq(quizzes.classId, id), eq(quizzes.schoolId, ctx.schoolId)));
    const [{ n: enrolled }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(enrollments)
      .where(and(eq(enrollments.classId, id), eq(enrollments.schoolId, ctx.schoolId)));

    if (quizCount === 0 && enrolled === 0) {
      await tx.delete(classes).where(and(eq(classes.id, id), eq(classes.schoolId, ctx.schoolId)));
      return "deleted";
    }
    await tx
      .update(classes)
      .set({ archivedAt: sql`now()` })
      .where(and(eq(classes.id, id), eq(classes.schoolId, ctx.schoolId)));
    return "archived";
  });
}
