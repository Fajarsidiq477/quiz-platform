import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import { generatePassword, hashPassword, passwordSchema } from "@/auth/password";
import { schools, users } from "./schema";
import type * as schema from "./schema";

type AnyPgDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const provisionInputSchema = z.object({
  schoolSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase letters, digits and hyphens"),
  /** Required only when the school does not exist yet. */
  schoolName: z.string().trim().min(1).optional(),
  email: emailSchema,
  name: z.string().trim().min(1),
  role: z.enum(["student", "admin"]),
  /** Omit to have one generated; it is returned once and never stored in plain text. */
  password: passwordSchema.optional(),
});

export type ProvisionInput = z.input<typeof provisionInputSchema>;

export class ProvisionError extends Error {}

/**
 * Creates a user with a password (and the school, if needed). This is the bootstrap path for
 * accounts, since there is no public sign-up. It must run on a privileged connection that bypasses
 * RLS (a superuser or BYPASSRLS role, `DATABASE_ADMIN_URL`), never on the web app's connection:
 * looking a school up by slug is not something the per-school policies allow.
 *
 * `temporaryPassword` is set only when a password was generated. It is the caller's one chance to
 * hand it to the person.
 */
export async function provisionUser(db: AnyPgDb, rawInput: ProvisionInput) {
  const input = provisionInputSchema.parse(rawInput);
  const generated = input.password === undefined ? generatePassword() : undefined;
  const passwordHash = await hashPassword(input.password ?? generated!);

  return db.transaction(async (tx) => {
    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);
    if (existingUser) throw new ProvisionError(`A user with email ${input.email} already exists`);

    let [school] = await tx
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.slug, input.schoolSlug))
      .limit(1);
    let createdSchool = false;
    if (!school) {
      if (!input.schoolName) {
        throw new ProvisionError(
          `School "${input.schoolSlug}" does not exist; pass a school name to create it`,
        );
      }
      [school] = await tx
        .insert(schools)
        .values({ name: input.schoolName, slug: input.schoolSlug })
        .returning({ id: schools.id });
      createdSchool = true;
    }

    const [user] = await tx
      .insert(users)
      .values({
        schoolId: school.id,
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
      })
      .returning({ id: users.id });

    return {
      schoolId: school.id,
      userId: user.id,
      createdSchool,
      temporaryPassword: generated,
    };
  });
}

/**
 * Sets a new password for an existing user (a forgotten password, or a first login) and clears any
 * lockout. Same privileged-connection requirement as `provisionUser`.
 */
export async function setUserPassword(db: AnyPgDb, rawEmail: string, rawPassword?: string) {
  const email = emailSchema.parse(rawEmail);
  const password = rawPassword === undefined ? undefined : passwordSchema.parse(rawPassword);
  const generated = password === undefined ? generatePassword() : undefined;
  const passwordHash = await hashPassword(password ?? generated!);

  const updated = await db
    .update(users)
    .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.email, email))
    .returning({ id: users.id });
  if (updated.length === 0) throw new ProvisionError(`No user with email ${email}`);

  return { userId: updated[0].id, temporaryPassword: generated };
}
