import { describe, expect, it } from "vitest";
import {
  canSeeResults,
  gradeAnswer,
  isAnswerCorrect,
  isAnswered,
  normalizeText,
  seededShuffle,
  type GradableItem,
} from "@/features/student/grading";

const options = (correct: number[], total = 4) =>
  Array.from({ length: total }, (_, i) => ({ id: `o${i}`, isCorrect: correct.includes(i) }));

const single: GradableItem = { type: "single_choice", points: "2.00", options: options([1]), acceptedAnswers: null };
const multi: GradableItem = { type: "multiple_choice", points: "3.00", options: options([0, 2]), acceptedAnswers: null };
const tf: GradableItem = { type: "true_false", points: "1.00", options: options([0], 2), acceptedAnswers: null };
const short: GradableItem = {
  type: "short_answer",
  points: "2.00",
  options: [],
  acceptedAnswers: ["Domain Name System", "DNS"],
};

describe("grading", () => {
  it("single choice: only the one correct option counts", () => {
    expect(gradeAnswer(single, { optionIds: ["o1"] })).toEqual({ isCorrect: true, pointsAwarded: 2 });
    expect(gradeAnswer(single, { optionIds: ["o0"] })).toEqual({ isCorrect: false, pointsAwarded: 0 });
    expect(isAnswerCorrect(single, { optionIds: ["o1", "o0"] })).toBe(false); // two picked
  });

  it("multiple choice is all-or-nothing: exactly the correct set", () => {
    expect(gradeAnswer(multi, { optionIds: ["o2", "o0"] })).toEqual({ isCorrect: true, pointsAwarded: 3 });
    expect(isAnswerCorrect(multi, { optionIds: ["o0"] })).toBe(false); // missing one
    expect(isAnswerCorrect(multi, { optionIds: ["o0", "o2", "o3"] })).toBe(false); // one extra
    expect(isAnswerCorrect(multi, { optionIds: ["o1", "o3"] })).toBe(false);
  });

  it("true/false works like single choice", () => {
    expect(isAnswerCorrect(tf, { optionIds: ["o0"] })).toBe(true);
    expect(isAnswerCorrect(tf, { optionIds: ["o1"] })).toBe(false);
  });

  it("short answer ignores case, spacing and full-width characters, but not wrong words", () => {
    for (const text of ["dns", "  DNS ", "domain   name\tsystem", "DOMAIN NAME SYSTEM", "ｄｎｓ"]) {
      expect(isAnswerCorrect(short, { text }), text).toBe(true);
    }
    for (const text of ["domain name", "dns server", "system"]) {
      expect(isAnswerCorrect(short, { text }), text).toBe(false);
    }
  });

  it("treats missing, empty and cleared answers as unanswered, worth 0", () => {
    for (const item of [single, multi, tf, short]) {
      for (const response of [undefined, null, {}, { optionIds: [] }, { text: "" }, { text: "   " }]) {
        expect(isAnswered(item, response), JSON.stringify(response)).toBe(false);
        expect(gradeAnswer(item, response)).toEqual({ isCorrect: false, pointsAwarded: 0 });
      }
    }
  });

  it("a short answer with no accepted answers can never be right", () => {
    expect(isAnswerCorrect({ ...short, acceptedAnswers: null }, { text: "dns" })).toBe(false);
    expect(isAnswerCorrect({ ...short, acceptedAnswers: [] }, { text: "dns" })).toBe(false);
  });

  it("awards the question's points, including decimals", () => {
    expect(gradeAnswer({ ...single, points: "2.50" }, { optionIds: ["o1"] }).pointsAwarded).toBe(2.5);
    expect(gradeAnswer({ ...single, points: 4 }, { optionIds: ["o1"] }).pointsAwarded).toBe(4);
  });

  it("normalises text", () => {
    expect(normalizeText("  Hello   WORLD ")).toBe("hello world");
  });
});

describe("results visibility", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const open = { status: "published" as const, closesAt: new Date("2026-10-01T13:00:00Z") };
  const pastWindow = { status: "published" as const, closesAt: new Date("2026-10-01T11:00:00Z") };
  const closed = { status: "closed" as const, closesAt: new Date("2026-10-01T13:00:00Z") };

  it("after_submit: always visible once submitted", () => {
    expect(canSeeResults("after_submit", open, now)).toBe(true);
  });

  it("after_close: hidden while the quiz is open, visible once it closes (by status or by time)", () => {
    expect(canSeeResults("after_close", open, now)).toBe(false);
    expect(canSeeResults("after_close", closed, now)).toBe(true);
    expect(canSeeResults("after_close", pastWindow, now)).toBe(true);
    expect(canSeeResults("after_close", { status: "published", closesAt: null }, now)).toBe(false);
  });

  it("never: never visible, even when closed", () => {
    expect(canSeeResults("never", closed, now)).toBe(false);
    expect(canSeeResults("never", pastWindow, now)).toBe(false);
  });
});

describe("seededShuffle", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  it("returns the same order for the same seed, and a permutation of the input", () => {
    const a = seededShuffle(items, "attempt-1");
    expect(seededShuffle(items, "attempt-1")).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
  });

  it("differs between seeds, and does not modify its input", () => {
    const copy = [...items];
    expect(seededShuffle(items, "attempt-1")).not.toEqual(seededShuffle(items, "attempt-2"));
    expect(items).toEqual(copy);
  });

  it("actually reorders (not the identity)", () => {
    expect(seededShuffle(items, "any seed")).not.toEqual(items);
  });

  it("copes with empty and single-item lists", () => {
    expect(seededShuffle([], "x")).toEqual([]);
    expect(seededShuffle(["a"], "x")).toEqual(["a"]);
  });
});
