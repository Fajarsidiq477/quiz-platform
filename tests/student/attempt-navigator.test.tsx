// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptRunner } from "@/components/student/attempt-runner";
import type { TakingItem } from "@/features/student/service";
import type { Answer, SaveResult } from "@/features/student/types";

const ITEMS: TakingItem[] = [
  {
    id: "q1",
    type: "single_choice",
    prompt: "Which layer routes packets?",
    points: 2,
    options: [
      { id: "a", text: "Data link" },
      { id: "b", text: "Network" },
    ],
  },
  {
    id: "q2",
    type: "multiple_choice",
    prompt: "Which are private ranges?",
    points: 3,
    options: [
      { id: "c", text: "10.0.0.0/8" },
      { id: "d", text: "8.8.8.0/24" },
    ],
  },
  { id: "q3", type: "short_answer", prompt: "What does DNS stand for?", points: 1, options: [] },
];

type SaveFn = (itemId: string, answer: Answer) => Promise<SaveResult>;

function setup(over: { initial?: Record<string, { optionIds?: string[]; text?: string }>; save?: SaveFn } = {}) {
  const save = vi.fn<SaveFn>(over.save ?? (async () => ({ ok: true, remainingMs: 600_000 })));
  render(
    <AttemptRunner
      title="Networking basics"
      description={null}
      items={ITEMS}
      initialAnswers={over.initial ?? {}}
      initialRemainingMs={600_000}
      save={save}
      submit={async () => undefined}
    />,
  );
  return { save };
}

const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const nav = () => within(screen.getByRole("navigation", { name: "Question navigator" }));
const chip = (n: number) => screen.getByRole("button", { name: new RegExp(`^Question ${n},`) });
const status = (n: number) => chip(n).getAttribute("data-status");

describe("question navigator", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("has one numbered button per question, none answered at first", () => {
    setup();
    expect(nav().getAllByRole("button")).toHaveLength(3);
    expect([1, 2, 3].map(status)).toEqual(["unanswered", "unanswered", "unanswered"]);
    expect(chip(2).getAttribute("aria-label")).toBe("Question 2, not answered yet");
    expect(nav().getByText("0 of 3 answered")).toBeTruthy();
  });

  it("starts from the answers already saved", () => {
    setup({ initial: { q1: { optionIds: ["b"] }, q3: { text: "domain name system" } } });
    expect([1, 2, 3].map(status)).toEqual(["answered", "unanswered", "answered"]);
    expect(chip(1).getAttribute("aria-label")).toBe("Question 1, answered");
    expect(nav().getByText("2 of 3 answered")).toBeTruthy();
  });

  it("marks a question answered as soon as it is, and unanswered again when it is cleared", async () => {
    setup();
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(status(1)).toBe("answered");
    expect(nav().getByText("1 of 3 answered")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear my answer" }));
    await tick();
    expect(status(1)).toBe("unanswered");
    expect(nav().getByText("0 of 3 answered")).toBeTruthy();
  });

  it("does not count an empty or blank text answer", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Your answer to question 3"), { target: { value: "   " } });
    await tick(700);
    expect(status(3)).toBe("unanswered");
    fireEvent.change(screen.getByLabelText("Your answer to question 3"), { target: { value: "DNS" } });
    await tick(700);
    expect(status(3)).toBe("answered");
  });

  it("counts a multiple choice question once any option is ticked", async () => {
    setup();
    fireEvent.click(screen.getByLabelText("10.0.0.0/8"));
    await tick();
    expect(status(2)).toBe("answered");
  });

  it("flags an answer that has not been saved, until it is", async () => {
    let fail = true;
    setup({
      save: async () => {
        if (fail) throw new Error("offline");
        return { ok: true, remainingMs: 600_000 };
      },
    });
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(status(1)).toBe("unsaved");
    expect(chip(1).getAttribute("aria-label")).toBe("Question 1, answered, but not saved yet");

    fail = false;
    await tick(3000); // the retry goes through
    expect(status(1)).toBe("answered");
  });

  describe("jumping", () => {
    it("scrolls to the question and moves focus there", async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      setup();

      fireEvent.click(chip(3));
      await tick();

      const target = document.getElementById("q-q3")!;
      expect(target.tagName).toBe("FIELDSET");
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.instances[0]).toBe(target);
      expect(document.activeElement).toBe(target);
      expect(chip(3).getAttribute("aria-current")).toBe("true");
      expect(chip(1).getAttribute("aria-current")).toBeNull();
    });

    it("does not answer or change anything by jumping", async () => {
      Element.prototype.scrollIntoView = vi.fn();
      const { save } = setup();
      fireEvent.click(chip(2));
      fireEvent.click(chip(1));
      await tick(5000);
      expect(save).not.toHaveBeenCalled();
      expect([1, 2, 3].map(status)).toEqual(["unanswered", "unanswered", "unanswered"]);
    });

    it("highlights the question being read while the student scrolls", async () => {
      let notify: (entries: { isIntersecting: boolean; target: Element }[]) => void = () => {};
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: typeof notify) {
            notify = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
      setup();
      expect(chip(1).getAttribute("aria-current")).toBeNull();

      await act(async () => notify([{ isIntersecting: true, target: document.getElementById("q-q2")! }]));
      expect(chip(2).getAttribute("aria-current")).toBe("true");

      await act(async () => notify([{ isIntersecting: false, target: document.getElementById("q-q2")! }]));
      expect(chip(2).getAttribute("aria-current")).toBe("true"); // leaving alone does not clear it
    });
  });

  it("gives every question a place to jump to", () => {
    setup();
    for (const item of ITEMS) {
      const el = document.getElementById(`q-${item.id}`);
      expect(el, item.id).not.toBeNull();
      expect(el!.getAttribute("tabindex")).toBe("-1");
    }
  });
});
