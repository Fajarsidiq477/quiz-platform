import { randomInt } from "node:crypto";

// No look-alike characters (I/O/0/1), so a code read out in class or copied by hand survives.
// 32 characters ^ 8 positions is about 10^12 codes, far too many to guess.
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;

export function generateJoinCode(): string {
  return Array.from(
    { length: JOIN_CODE_LENGTH },
    () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)],
  ).join("");
}

/**
 * Turns what a student typed into the stored form: upper case, with spaces, hyphens and other
 * separators removed ("k7m2-x9qp" -> "K7M2X9QP"). Does not check validity; see isJoinCode.
 */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isJoinCode(value: string): boolean {
  return (
    value.length === JOIN_CODE_LENGTH && [...value].every((c) => JOIN_CODE_ALPHABET.includes(c))
  );
}

/** "K7M2X9QP" -> "K7M2-X9QP", for showing to people. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
