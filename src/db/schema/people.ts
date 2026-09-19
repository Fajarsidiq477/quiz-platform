import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { citext, createdAt, pk, schoolId, tstz } from "./_columns";
import { enrollmentStatus, userRole, userStatus } from "./enums";

export const users = pgTable(
  "users",
  {
    id: pk(),
    schoolId: schoolId(),
    // Globally unique (Auth.js resolves sign-in by email); a user belongs to exactly one school.
    email: citext("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull(),
    /** `scrypt$N$r$p$salt$hash` (see src/auth/password.ts). Null = cannot sign in yet. */
    passwordHash: text("password_hash"),
    // Brute-force lockout, maintained by src/auth/sign-in-policy.ts.
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    status: userStatus("status").notNull().default("active"),
    archivedAt: tstz("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("users_email_uq").on(t.email),
    check("users_failed_login_attempts_ck", sql`${t.failedLoginAttempts} >= 0`),
    unique("users_id_school_uq").on(t.id, t.schoolId),
    index("users_school_role_idx").on(t.schoolId, t.role),
  ],
);

export const classes = pgTable(
  "classes",
  {
    id: pk(),
    schoolId: schoolId(),
    // The teacher role is enforced in the app; the FK guarantees same-school.
    teacherId: uuid("teacher_id").notNull(),
    name: text("name").notNull(),
    term: text("term").notNull(),
    archivedAt: tstz("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "classes_teacher_fk",
      columns: [t.teacherId, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    unique("classes_school_term_name_uq").on(t.schoolId, t.term, t.name),
    unique("classes_id_school_uq").on(t.id, t.schoolId),
    index("classes_teacher_idx").on(t.teacherId),
  ],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: pk(),
    schoolId: schoolId(),
    classId: uuid("class_id").notNull(),
    studentId: uuid("student_id").notNull(),
    status: enrollmentStatus("status").notNull().default("active"),
    enrolledAt: tstz("enrolled_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "enrollments_class_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),
    foreignKey({
      name: "enrollments_student_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    unique("enrollments_class_student_uq").on(t.classId, t.studentId),
    unique("enrollments_id_school_uq").on(t.id, t.schoolId),
    index("enrollments_student_status_idx").on(t.studentId, t.status),
  ],
);
