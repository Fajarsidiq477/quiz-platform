import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticate } from "@/auth/sign-in-policy";
import * as schema from "@/db/schema";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  generateJoinCode,
  isJoinCode,
  normalizeJoinCode,
} from "@/features/classes/join-code";
import { getClass, listClasses, setJoinCode } from "@/features/classes/service";
import { registerInputSchema } from "@/features/register/schemas";
import { findClassByJoinCode, registerStudent } from "@/features/register/service";
import { addQuestion, createQuiz, publishQuiz } from "@/features/quizzes/service";
import { questionInputSchema } from "@/features/quizzes/schemas";
import {
  asAppRole,
  createAppRole,
  createTestDb,
  seedSchool,
  startAttempt,
  type TestDb,
  type World,
} from "../db/helpers";

const valid = (code: string, over: Record<string, unknown> = {}) => ({
  name: "  Siti Aminah ",
  email: " Siti@Example.Test ",
  password: "a good password",
  confirmPassword: "a good password",
  code,
  ...over,
});

describe("join codes", () => {
  it("makes 8 characters from the unambiguous alphabet, and they differ", () => {
    const codes = Array.from({ length: 200 }, generateJoinCode);
    for (const code of codes) {
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect([...code].every((c) => JOIN_CODE_ALPHABET.includes(c))).toBe(true);
      expect(isJoinCode(code)).toBe(true);
    }
    expect(new Set(codes).size).toBe(200);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  it("normalises what a student typed", () => {
    expect(normalizeJoinCode(" k7m2-x9qp ")).toBe("K7M2X9QP");
    expect(normalizeJoinCode("K7M2 X9QP")).toBe("K7M2X9QP");
    expect(normalizeJoinCode("k7m2_x9qp.")).toBe("K7M2X9QP");
    expect(isJoinCode(normalizeJoinCode("k7m2-x9qp"))).toBe(true);
    expect(formatJoinCode("K7M2X9QP")).toBe("K7M2-X9QP");
  });

  it("rejects codes of the wrong length or with look-alike characters", () => {
    expect(isJoinCode("K7M2X9Q")).toBe(false); // 7
    expect(isJoinCode("K7M2X9QPP")).toBe(false); // 9
    expect(isJoinCode("K7M2X9QO")).toBe(false); // has an O
    expect(isJoinCode("K7M2X9Q1")).toBe(false); // has a 1
    expect(isJoinCode("")).toBe(false);
  });
});

describe("registerInputSchema", () => {
  it("accepts a valid form and cleans it up", () => {
    const r = registerInputSchema.parse(valid("k7m2-x9qp"));
    expect(r).toMatchObject({ name: "Siti Aminah", email: "siti@example.test", code: "K7M2X9QP" });
  });

  it("rejects bad input with a message for the right field", () => {
    const fail = (over: Record<string, unknown>) => {
      const result = registerInputSchema.safeParse(valid("K7M2X9QP", over));
      expect(result.success).toBe(false);
      return result.error!.issues.map((i) => i.path[0]);
    };
    expect(fail({ name: "  " })).toContain("name");
    expect(fail({ email: "not-an-email" })).toContain("email");
    expect(fail({ password: "short", confirmPassword: "short" })).toContain("password");
    expect(fail({ confirmPassword: "different password" })).toContain("confirmPassword");
    expect(fail({ code: "123" })).toContain("code");
    expect(fail({ code: "" })).toContain("code");
  });
});

describe("class join codes (admin)", () => {
  let db: TestDb;
  let a: World;
  let b: World;
  const ctx = (w: World) => ({ schoolId: w.school.id, userId: w.teacher.id });
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    a = await seedSchool(db);
    b = await seedSchool(db);
  });

  it("starts with no code, and generates, replaces and turns off a code", async () => {
    expect((await as(() => getClass(db, a.school.id, a.cls.id)))?.joinCode).toBeNull();

    const first = (await as(() => setJoinCode(db, ctx(a), a.cls.id, "generate")))!;
    expect(isJoinCode(first)).toBe(true);
    expect((await as(() => getClass(db, a.school.id, a.cls.id)))?.joinCode).toBe(first);

    const second = (await as(() => setJoinCode(db, ctx(a), a.cls.id, "generate")))!;
    expect(second).not.toBe(first);
    expect((await as(() => getClass(db, a.school.id, a.cls.id)))?.joinCode).toBe(second);

    expect(await as(() => setJoinCode(db, ctx(a), a.cls.id, "disable"))).toBeNull();
    expect((await as(() => getClass(db, a.school.id, a.cls.id)))?.joinCode).toBeNull();
  });

  it("shows the code and the number of enrolled students in the class list", async () => {
    const code = (await as(() => setJoinCode(db, ctx(a), a.cls.id, "generate")))!;
    const [row] = await as(() => listClasses(db, a.school.id));
    expect(row).toMatchObject({ id: a.cls.id, joinCode: code, studentCount: 1 }); // the seeded student
  });

  it("does not count withdrawn students", async () => {
    const w = await seedSchool(db);
    await db.update(schema.enrollments).set({ status: "withdrawn" }).where(eq(schema.enrollments.classId, w.cls.id));
    expect((await as(() => getClass(db, w.school.id, w.cls.id)))?.studentCount).toBe(0);
  });

  it("gives every class its own code, unique across schools", async () => {
    const codeA = (await as(() => setJoinCode(db, ctx(a), a.cls.id, "generate")))!;
    const codeB = (await as(() => setJoinCode(db, ctx(b), b.cls.id, "generate")))!;
    expect(codeA).not.toBe(codeB);
    // The database itself refuses a duplicate, and a malformed code.
    await expect(
      db.update(schema.classes).set({ joinCode: codeA }).where(eq(schema.classes.id, b.cls.id)),
    ).rejects.toThrow();
    await expect(
      db.update(schema.classes).set({ joinCode: "abc" }).where(eq(schema.classes.id, b.cls.id)),
    ).rejects.toThrow();
  });

  it("never lets one school change another school's code", async () => {
    await expect(as(() => setJoinCode(db, ctx(a), b.cls.id, "generate"))).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(as(() => setJoinCode(db, ctx(a), "nope", "disable"))).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("student registration", () => {
  let db: TestDb;
  let w: World;
  let code: string;
  const ctx = () => ({ schoolId: w.school.id, userId: w.teacher.id });
  const as = <T>(fn: () => Promise<T>) => asAppRole(db, fn);
  const register = (over: Record<string, unknown> = {}, useCode = code) =>
    as(() => registerStudent(db, registerInputSchema.parse(valid(useCode, over))));

  beforeAll(async () => {
    db = await createTestDb();
    await createAppRole(db);
    w = await seedSchool(db);
    code = (await as(() => setJoinCode(db, ctx(), w.cls.id, "generate")))!;
  });

  it("finds a class by its code with no school set, and never by anything else", async () => {
    const found = await as(() => findClassByJoinCode(db, code));
    expect(found).toMatchObject({ classId: w.cls.id, schoolId: w.school.id, className: "ICT 10A" });
    expect(await as(() => findClassByJoinCode(db, "ZZZZZZZZ"))).toBeNull();
    expect(await as(() => findClassByJoinCode(db, ""))).toBeNull();
    // Without the lookup, the app role cannot see any class at all.
    expect(await as(() => db.select().from(schema.classes))).toEqual([]);
  });

  it("creates an active student, enrols them in the class, and lets them sign in", async () => {
    const result = await register();
    expect(result).toMatchObject({ classId: w.cls.id, schoolId: w.school.id });

    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, result.userId));
    expect(user).toMatchObject({
      email: "siti@example.test",
      name: "Siti Aminah",
      role: "student",
      status: "active",
      schoolId: w.school.id,
    });
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain("a good password");

    const rows = await db.select().from(schema.enrollments).where(eq(schema.enrollments.studentId, user.id));
    expect(rows).toEqual([expect.objectContaining({ classId: w.cls.id, status: "active", schoolId: w.school.id })]);

    const signedIn = await as(() => authenticate(db, { email: "SITI@example.test", password: "a good password" }));
    expect(signedIn).toMatchObject({ ok: true, user: { id: user.id, role: "student" } });
  });

  it("accepts the code however it was typed", async () => {
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`;
    const result = await register({ email: "typed@example.test" }, typed);
    expect(result.classId).toBe(w.cls.id);
  });

  it("refuses an unknown code and creates nothing", async () => {
    const before = await db.select().from(schema.users);
    await expect(register({ email: "nocode@example.test" }, "ZZZZZZZZ")).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringMatching(/class code is not valid/),
    });
    expect(await db.select().from(schema.users)).toHaveLength(before.length);
  });

  it("stops working when the code is turned off, replaced, or the class is archived", async () => {
    const w2 = await seedSchool(db);
    const c2 = { schoolId: w2.school.id, userId: w2.teacher.id };
    const first = (await as(() => setJoinCode(db, c2, w2.cls.id, "generate")))!;
    const reg = (email: string, c: string) =>
      as(() => registerStudent(db, registerInputSchema.parse(valid(c, { email }))));

    await expect(reg("ok1@example.test", first)).resolves.toBeTruthy();

    const second = (await as(() => setJoinCode(db, c2, w2.cls.id, "generate")))!;
    await expect(reg("old@example.test", first)).rejects.toMatchObject({ code: "not_found" });
    await expect(reg("ok2@example.test", second)).resolves.toBeTruthy();

    await as(() => setJoinCode(db, c2, w2.cls.id, "disable"));
    await expect(reg("off@example.test", second)).rejects.toMatchObject({ code: "not_found" });

    const third = (await as(() => setJoinCode(db, c2, w2.cls.id, "generate")))!;
    await db.update(schema.classes).set({ archivedAt: new Date() }).where(eq(schema.classes.id, w2.cls.id));
    await expect(reg("archived@example.test", third)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses an email that is already registered (any case) and leaves no half-made student", async () => {
    await register({ email: "dup@example.test" });
    const usersBefore = (await db.select().from(schema.users)).length;
    const enrolBefore = (await db.select().from(schema.enrollments)).length;

    await expect(register({ email: "DUP@example.test" })).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/already exists/),
    });
    // Also when the existing account belongs to another school (email is unique everywhere).
    await expect(register({ email: w.teacher.email })).rejects.toMatchObject({ code: "conflict" });

    expect(await db.select().from(schema.users)).toHaveLength(usersBefore);
    expect(await db.select().from(schema.enrollments)).toHaveLength(enrolBefore);
  });

  it("puts each student in the school of the class whose code they used", async () => {
    const other = await seedSchool(db);
    const otherCode = (await as(() => setJoinCode(db, { schoolId: other.school.id, userId: other.teacher.id }, other.cls.id, "generate")))!;
    const result = await register({ email: "elsewhere@example.test" }, otherCode);
    expect(result.schoolId).toBe(other.school.id);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, result.userId));
    expect(user.schoolId).toBe(other.school.id);
  });

  it("gives a registered student real access: they can start a quiz assigned to their class", async () => {
    const quizCtx = ctx();
    const now = Date.now();
    const quiz = await as(() =>
      createQuiz(db, quizCtx, {
        title: "Networking",
        description: null,
        classId: w.cls.id,
        timeLimitMinutes: 30,
        opensAt: new Date(now - 3_600_000),
        closesAt: new Date(now + 3_600_000),
        maxAttempts: 1,
        shuffleQuestions: false,
        resultsVisibility: "after_close",
      }),
    );
    await as(() =>
      addQuestion(db, quizCtx, quiz.id, questionInputSchema.parse({ type: "true_false", prompt: "x", correct: true })),
    );
    await as(() => publishQuiz(db, quizCtx, quiz.id));

    const student = await register({ email: "quiztaker@example.test" });
    // The database only lets an enrolled student start an attempt: enrolment is what makes it work.
    const attempt = await db
      .insert(schema.attempts)
      .values({ schoolId: w.school.id, quizId: quiz.id, studentId: student.userId })
      .returning();
    expect(attempt[0].status).toBe("in_progress");

    // A student of another school's class cannot.
    const outsider = await seedSchool(db);
    await expect(startAttempt(db, { ...w, student: outsider.student } as World, quiz.id)).rejects.toThrow();
  });
});
