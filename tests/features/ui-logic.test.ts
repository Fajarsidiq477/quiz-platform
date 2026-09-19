import { describe, expect, it } from "vitest";
import { formatLocal, isoToLocalInput, localInputToIso } from "@/components/admin/date-utils";
import {
  MAX_OPTIONS,
  addOption,
  blankOptions,
  buildPayload,
  draftFromItem,
  emptyDraft,
  removeOption,
  selectOnly,
  toggleCorrect,
  withType,
  type QuestionDraft,
} from "@/components/admin/quizzes/question-draft";
import { toVersionContent } from "@/features/quizzes/content";
import { questionInputSchema } from "@/features/quizzes/schemas";

describe("date helpers", () => {
  it("round-trips an instant through a datetime-local value (to the minute)", () => {
    const iso = "2026-10-01T01:30:00.000Z";
    const local = isoToLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localInputToIso(local)).toBe(iso);
  });

  it("reads a datetime-local value in the browser's own time zone", () => {
    // 08:00 typed by the teacher is 08:00 on their clock, whatever zone that is.
    const typed = "2026-10-01T08:00";
    expect(new Date(localInputToIso(typed)).getHours()).toBe(8);
    expect(isoToLocalInput(localInputToIso(typed))).toBe(typed);
  });

  it("treats blank and invalid input as empty", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("nonsense")).toBe("");
    expect(localInputToIso("")).toBe("");
    expect(localInputToIso("nonsense")).toBe("");
    expect(formatLocal(null)).toBe("");
    expect(formatLocal("nonsense")).toBe("");
    expect(formatLocal("2026-10-01T01:30:00.000Z")).not.toBe("");
  });
});

describe("question draft", () => {
  const filled = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
    ...emptyDraft(),
    prompt: "Which layer routes packets?",
    options: [
      { text: "Data link", isCorrect: false },
      { text: "Network", isCorrect: true },
      { text: "Transport", isCorrect: false },
    ],
    ...over,
  });

  it("starts as a single-choice question with two blank options, first one correct", () => {
    const draft = emptyDraft();
    expect(draft).toMatchObject({ type: "single_choice", points: "1" });
    expect(draft.options).toEqual(blankOptions());
  });

  it("builds a payload the server schema accepts, for every type", () => {
    const payloads = [
      buildPayload(filled()),
      buildPayload(filled({ type: "multiple_choice" })),
      buildPayload(filled({ type: "true_false", trueFalseCorrect: false })),
      buildPayload(filled({ type: "short_answer", acceptedAnswers: " router \n\n switch \n" })),
    ];
    for (const payload of payloads) {
      const result = questionInputSchema.safeParse(payload);
      expect(result.success, JSON.stringify(payload)).toBe(true);
    }
    expect(payloads[3]).toMatchObject({ acceptedAnswers: ["router", "switch"] });
    expect(payloads[2]).toMatchObject({ correct: false });
    expect(payloads[2]).not.toHaveProperty("options");
  });

  it("switching to single choice keeps only the first correct option", () => {
    const multi = filled({
      type: "multiple_choice",
      options: [
        { text: "a", isCorrect: false },
        { text: "b", isCorrect: true },
        { text: "c", isCorrect: true },
      ],
    });
    expect(withType(multi, "single_choice").options.map((o) => o.isCorrect)).toEqual([false, true, false]);
    // No correct option at all: the first one is marked.
    const none = filled({ options: filled().options.map((o) => ({ ...o, isCorrect: false })) });
    expect(withType(none, "single_choice").options.map((o) => o.isCorrect)).toEqual([true, false, false]);
    // Other types leave the options alone.
    expect(withType(multi, "multiple_choice").options).toEqual(multi.options);
  });

  it("selects one option, or toggles options independently", () => {
    const d = filled();
    expect(selectOnly(d, 2).options.map((o) => o.isCorrect)).toEqual([false, false, true]);
    const toggled = toggleCorrect(toggleCorrect(d, 0), 1);
    expect(toggled.options.map((o) => o.isCorrect)).toEqual([true, false, false]);
  });

  it("adds options up to the limit and removes them down to two", () => {
    let d = filled();
    for (let i = 0; i < MAX_OPTIONS + 3; i++) d = addOption(d); // more attempts than the limit
    expect(d.options).toHaveLength(MAX_OPTIONS);

    let small = filled();
    small = removeOption(removeOption(removeOption(small, 0), 0), 0);
    expect(small.options).toHaveLength(2);
  });

  it("removing the correct option of a single-choice question keeps one option correct", () => {
    const d = removeOption(filled(), 1); // "Network" was the correct one
    expect(d.options.map((o) => o.text)).toEqual(["Data link", "Transport"]);
    expect(d.options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  it("restores a stored question into an editable draft", () => {
    const stored = toVersionContent(
      questionInputSchema.parse({
        type: "multiple_choice",
        prompt: "Pick private ranges",
        points: 2.5,
        explanation: "RFC 1918",
        options: [
          { text: "10.0.0.0/8", isCorrect: true },
          { text: "8.8.8.0/24", isCorrect: false },
        ],
      }),
    );
    const draft = draftFromItem({ ...stored, points: stored.points });
    expect(draft).toMatchObject({
      type: "multiple_choice",
      prompt: "Pick private ranges",
      points: "2.5",
      explanation: "RFC 1918",
    });
    // Editing and saving without changes produces an identical question.
    expect(questionInputSchema.parse(buildPayload(draft))).toMatchObject({
      type: "multiple_choice",
      options: stored.options,
    });

    const tf = draftFromItem({
      ...toVersionContent(questionInputSchema.parse({ type: "true_false", prompt: "x", correct: false })),
    });
    expect(tf.trueFalseCorrect).toBe(false);

    const short = draftFromItem(
      toVersionContent(
        questionInputSchema.parse({ type: "short_answer", prompt: "x", acceptedAnswers: ["a", "b"] }),
      ),
    );
    expect(short.acceptedAnswers).toBe("a\nb");
    expect(short.options).toEqual(blankOptions());
  });
});
