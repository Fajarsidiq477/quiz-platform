import { describe, expect, it } from "vitest";
import {
  generatePassword,
  hashPassword,
  loginSchema,
  passwordSchema,
  verifyPassword,
} from "@/auth/password";

describe("password hashing", () => {
  it("round-trips, and never stores the password itself", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash, so equal passwords give different hashes", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("treats visually identical unicode forms as the same password", async () => {
    const hash = await hashPassword("password123");
    expect(await verifyPassword("ｐａｓｓｗｏｒｄ１２３", hash)).toBe(true); // full-width characters
  });

  it("returns false, without throwing, for malformed or hostile stored hashes", async () => {
    for (const bad of [
      "",
      "not a hash",
      "scrypt$bad",
      "bcrypt$32768$8$3$c2FsdA==$a2V5",
      "scrypt$32768$8$3$$", // empty salt and key
      "scrypt$1073741824$8$3$c2FsdA==$a2V5", // cost far above the allowed maximum
      "scrypt$30000$8$3$c2FsdA==$a2V5", // not a power of two
      "scrypt$32768$8$99$c2FsdA==$a2V5", // parallelism out of range
    ]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  });
});

describe("generatePassword", () => {
  it("makes passwords of the requested length from unambiguous characters", () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(12);
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    expect(generatePassword(20)).toHaveLength(20);
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });

  it("always satisfies the password rules", () => {
    expect(passwordSchema.safeParse(generatePassword()).success).toBe(true);
  });
});

describe("input schemas", () => {
  it("enforces password length when choosing a password", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("only checks the shape of a login, and caps the length", () => {
    expect(loginSchema.safeParse({ email: " a@b.test ", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.test", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.test", password: "x".repeat(201) }).success).toBe(
      false,
    );
    expect(loginSchema.safeParse({ email: "a@b.test" }).success).toBe(false);
    expect(loginSchema.safeParse(null).success).toBe(false);
  });
});
