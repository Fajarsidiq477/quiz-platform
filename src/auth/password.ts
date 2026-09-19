import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { z } from "zod";

// scrypt parameters from the OWASP password-storage cheat sheet (N=2^15, r=8, p=3, ~32 MiB).
// They are stored inside every hash, so they can be raised later without breaking old hashes.
const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";

/** Rules for choosing a password (used when an admin sets one). */
export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters");

/** Login only checks the shape, never the strength rules, and caps the length. */
export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1).max(200),
});

type ScryptParams = { N: number; r: number; p: number };

function derive(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r };
  return new Promise((resolve, reject) => {
    // NFKC so the same visible password always hashes the same way on different keyboards.
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return [PREFIX, N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

function parse(stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const key = Buffer.from(parts[5], "base64");
  const powerOfTwo = Number.isInteger(N) && N >= 2 && (N & (N - 1)) === 0;
  if (!powerOfTwo || N > 2 ** 20 || !Number.isInteger(r) || r < 1 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16 || salt.length === 0 || key.length === 0) return null;
  return { params: { N, r, p }, salt, key };
}

/** True only for a well-formed hash that matches. Malformed input is simply false, never a throw. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt, parsed.params);
  return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
}

let dummyHash: Promise<string> | undefined;

/**
 * A real hash of a random password, verified against when the account does not exist so that
 * "unknown email" takes as long as "wrong password" and cannot be told apart by timing.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

// No look-alike characters (0/O, 1/l/I), so a password read out or copied by hand survives.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generatePassword(length = 12): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
