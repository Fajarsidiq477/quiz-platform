import { describe, expect, it } from "vitest";
import { sameQuestion, toVersionContent } from "@/features/quizzes/content";
import { questionInputSchema, quizInputSchema } from "@/features/quizzes/schemas";
import { classInputSchema } from "@/features/classes/schemas";

const CLASS_ID = "0b9f6c3e-7d3a-4f5e-8f0a-1c2d3e4f5a6b";

const validQuiz = {
  title: "  Networking basics ",
  description: "",
  classId: CLASS_ID,
  timeLimitMinutes: "30",
  opensAt: "2026-10-01T01:00:00.000Z",
  closesAt: "2026-10-01T03:00:00.000Z",
  maxAttempts: "2",
  shuffleQuestions: true,
  resultsVisibility: "after_close",
};

describe("classInputSchema", () => {
  it("trims, and requires a name and a term", () => {
    expect(classInputSchema.parse({ name: " ICT 10A ", term: " 2026-1 " })).toEqual({
      name: "ICT 10A",
      term: "2026-1",
    });
    expect(classInputSchema.safeParse({ name: "", term: "2026-1" }).success).toBe(false);
    expect(classInputSchema.safeParse({ name: "A", term: "  " }).success).toBe(false);
  });
});

describe("quizInputSchema", () => {
  it("parses a form submission into typed values", () => {
    const quiz = quizInputSchema.parse(validQuiz);
    expect(quiz).toMatchObject({
      title: "Networking basics",
      description: null,
      classId: CLASS_ID,
      timeLimitMinutes: 30,
      maxAttempts: 2,
      shuffleQuestions: true,
      resultsVisibility: "after_close",
    });
    expect(quiz.opensAt).toEqual(new Date("2026-10-01T01:00:00.000Z"));
    expect(quiz.closesAt).toEqual(new Date("2026-10-01T03:00:00.000Z"));
  });

  it("treats blank optional fields as not set", () => {
    const quiz = quizInputSchema.parse({
      ...validQuiz,
      timeLimitMinutes: "",
      opensAt: "",
      closesAt: "   ",
    });
    expect(quiz.timeLimitMinutes).toBeNull();
    expect(quiz.opensAt).toBeNull();
    expect(quiz.closesAt).toBeNull();
  });

  it("rejects bad values with a message for the right field", () => {
    const fail = (over: Record<string, unknown>) => {
      const result = quizInputSchema.safeParse({ ...validQuiz, ...over });
      expect(result.success).toBe(false);
      return result.error!.issues.map((i) => i.path[0]);
    };
    expect(fail({ title: "  " })).toContain("title");
    expect(fail({ classId: "not-a-uuid" })).toContain("classId");
    expect(fail({ timeLimitMinutes: "0" })).toContain("timeLimitMinutes");
    expect(fail({ timeLimitMinutes: "1.5" })).toContain("timeLimitMinutes");
    expect(fail({ timeLimitMinutes: "abc" })).toContain("timeLimitMinutes");
    expect(fail({ maxAttempts: "0" })).toContain("maxAttempts");
    expect(fail({ maxAttempts: "21" })).toContain("maxAttempts");
    expect(fail({ opensAt: "yesterday" })).toContain("opensAt");
    expect(fail({ resultsVisibility: "always" })).toContain("resultsVisibility");
  });

  it("requires the closing time to be after the opening time", () => {
    const result = quizInputSchema.safeParse({
      ...validQuiz,
      opensAt: "2026-10-01T03:00:00.000Z",
      closesAt: "2026-10-01T01:00:00.000Z",
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(["closesAt"]);
  });
});

describe("questionInputSchema", () => {
  const base = { prompt: "  Which layer routes packets? ", points: "2", explanation: "" };
  const opts = (...correct: boolean[]) =>
    correct.map((isCorrect, i) => ({ text: `Option ${i + 1}`, isCorrect }));

  it("accepts a valid question of each type", () => {
    const single = questionInputSchema.parse({
      ...base,
      type: "single_choice",
      options: opts(false, true, false),
    });
    expect(single).toMatchObject({ prompt: "Which layer routes packets?", points: 2, explanation: null });

    expect(
      questionInputSchema.safeParse({ ...base, type: "multiple_choice", options: opts(true, true, false) })
        .success,
    ).toBe(true);
    expect(questionInputSchema.safeParse({ ...base, type: "true_false", correct: false }).success).toBe(
      true,
    );
    expect(
      questionInputSchema.safeParse({ ...base, type: "short_answer", acceptedAnswers: ["router"] }).success,
    ).toBe(true);
  });

  it("enforces the correct-answer rules per type", () => {
    const parse = (input: unknown) => questionInputSchema.safeParse(input);
    expect(parse({ ...base, type: "single_choice", options: opts(true, true) }).success).toBe(false);
    expect(parse({ ...base, type: "single_choice", options: opts(false, false) }).success).toBe(false);
    expect(parse({ ...base, type: "multiple_choice", options: opts(false, false) }).success).toBe(false);
    expect(parse({ ...base, type: "single_choice", options: opts(true) }).success).toBe(false);
    expect(parse({ ...base, type: "single_choice", options: opts(...Array(11).fill(false), true) }).success).toBe(false);
  });

  it("requires a prompt, options with text, and at least one accepted answer", () => {
    const parse = (input: unknown) => questionInputSchema.safeParse(input);
    expect(parse({ ...base, prompt: "  ", type: "true_false", correct: true }).success).toBe(false);
    expect(
      parse({ ...base, type: "single_choice", options: [{ text: " ", isCorrect: true }, { text: "b", isCorrect: false }] })
        .success,
    ).toBe(false);
    expect(parse({ ...base, type: "short_answer", acceptedAnswers: [] }).success).toBe(false);
    expect(parse({ ...base, type: "short_answer", acceptedAnswers: ["  "] }).success).toBe(false);
    expect(parse({ ...base, type: "essay" }).success).toBe(false);
  });

  it("defaults blank points to 1 and limits decimals", () => {
    const tf = { type: "true_false", prompt: "p", correct: true };
    expect(questionInputSchema.parse({ ...tf, points: "" })).toMatchObject({ points: 1 });
    expect(questionInputSchema.parse({ ...tf, points: "2.5" })).toMatchObject({ points: 2.5 });
    expect(questionInputSchema.safeParse({ ...tf, points: "1.234" }).success).toBe(false);
    expect(questionInputSchema.safeParse({ ...tf, points: "-1" }).success).toBe(false);
    expect(questionInputSchema.safeParse({ ...tf, points: "1001" }).success).toBe(false);
  });

  it("removes duplicate accepted answers", () => {
    const q = questionInputSchema.parse({
      ...base,
      type: "short_answer",
      acceptedAnswers: [" router ", "router", "Router"],
    });
    expect(q).toMatchObject({ acceptedAnswers: ["router", "Router"] });
  });
});

describe("version content", () => {
  const parse = (input: unknown) => toVersionContent(questionInputSchema.parse(input));

  it("turns true/false into two fixed options", () => {
    const content = parse({ type: "true_false", prompt: "p", correct: false });
    expect(content.options).toEqual([
      { text: "True", isCorrect: false },
      { text: "False", isCorrect: true },
    ]);
    expect(content.acceptedAnswers).toBeNull();
  });

  it("formats points the way Postgres stores them", () => {
    expect(parse({ type: "true_false", prompt: "p", correct: true, points: "2" }).points).toBe("2.00");
  });

  it("treats a change of points alone as the same question, but not a change of content", () => {
    const a = parse({ type: "short_answer", prompt: "p", acceptedAnswers: ["x"], points: "1" });
    const samePointsDifferent = parse({ type: "short_answer", prompt: "p", acceptedAnswers: ["x"], points: "5" });
    expect(sameQuestion(a, samePointsDifferent)).toBe(true);
    expect(sameQuestion(a, parse({ type: "short_answer", prompt: "p2", acceptedAnswers: ["x"] }))).toBe(false);
    expect(sameQuestion(a, parse({ type: "short_answer", prompt: "p", acceptedAnswers: ["y"] }))).toBe(false);
    expect(sameQuestion(a, parse({ type: "true_false", prompt: "p", correct: true }))).toBe(false);
  });
});
