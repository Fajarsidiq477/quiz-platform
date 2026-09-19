// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptRunner } from "@/components/student/attempt-runner";
import type { TakingItem } from "@/features/student/service";
import type { Answer, SaveResult, SubmitResult } from "@/features/student/types";

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
      { id: "e", text: "192.168.0.0/16" },
    ],
  },
  { id: "q3", type: "short_answer", prompt: "What does DNS stand for?", points: 1, options: [] },
];

type SaveFn = (itemId: string, answer: Answer) => Promise<SaveResult>;
type SubmitFn = (answers: Record<string, Answer>) => Promise<SubmitResult | void>;

function setup(
  over: {
    remainingMs?: number;
    initial?: Record<string, { optionIds?: string[]; text?: string }>;
    save?: SaveFn;
    submit?: SubmitFn;
  } = {},
) {
  const save = vi.fn<SaveFn>(over.save ?? (async () => ({ ok: true, remainingMs: 600_000 })));
  const submit = vi.fn<SubmitFn>(over.submit ?? (async () => undefined));
  render(
    <AttemptRunner
      title="Networking basics"
      description={null}
      items={ITEMS}
      initialAnswers={over.initial ?? {}}
      initialRemainingMs={over.remainingMs ?? 600_000}
      save={save}
      submit={submit}
    />,
  );
  return { save, submit };
}

/** Lets timers and promises run inside React's act(). */
const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const timer = () => screen.getByRole("timer").textContent;

describe("AttemptRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows every question with its options and points, and no answer key", () => {
    setup();
    expect(screen.getByText("Which layer routes packets?")).toBeTruthy();
    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("192.168.0.0/16")).toBeTruthy();
    expect(screen.getByText("What does DNS stand for?")).toBeTruthy();
    expect(screen.getByText(/Select all that apply/)).toBeTruthy();
    expect(screen.getByText(/· 2 points/)).toBeTruthy();
    expect(screen.getByText(/· 1 point$/)).toBeTruthy();
    expect(screen.getByText("Answered 0 of 3")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/correct/i);
  });

  it("restores answers saved earlier", () => {
    setup({ initial: { q1: { optionIds: ["b"] }, q2: { optionIds: ["c", "e"] }, q3: { text: "dns" } } });
    expect((screen.getByLabelText("Network") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Data link") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("10.0.0.0/8") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("8.8.8.0/24") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Your answer to question 3") as HTMLTextAreaElement).value).toBe("dns");
    expect(screen.getByText("Answered 3 of 3")).toBeTruthy();
  });

  it("counts down from the time the server reported", async () => {
    setup({ remainingMs: 65_000 });
    expect(timer()).toBe("01:05");
    await tick(5_000);
    expect(timer()).toBe("01:00");
    await tick(30_000);
    expect(timer()).toBe("00:30");
  });

  it("announces when time is getting short", async () => {
    setup({ remainingMs: 301_000 });
    await tick(2_000); // now under 5 minutes
    expect(screen.getByText("Less than 5 minutes left")).toBeTruthy();
    await tick(240_000); // under 1 minute
    expect(screen.getByText("Less than 1 minute left")).toBeTruthy();
  });

  it("saves a chosen option at once, and shows that it was saved", async () => {
    const { save } = setup();
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(save).toHaveBeenCalledWith("q1", { optionIds: ["b"] });
    expect(screen.getByText("Answered 1 of 3")).toBeTruthy();
    expect(screen.getByText("All answers saved")).toBeTruthy();
  });

  it("radio buttons replace the choice, and it can be cleared", async () => {
    const { save } = setup();
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    fireEvent.click(screen.getByLabelText("Data link"));
    await tick();
    expect(save).toHaveBeenLastCalledWith("q1", { optionIds: ["a"] });

    fireEvent.click(screen.getByRole("button", { name: "Clear my answer" }));
    await tick();
    expect(save).toHaveBeenLastCalledWith("q1", { optionIds: [] });
    expect(screen.getByText("Answered 0 of 3")).toBeTruthy();
  });

  it("checkboxes toggle independently", async () => {
    const { save } = setup();
    fireEvent.click(screen.getByLabelText("10.0.0.0/8"));
    await tick();
    fireEvent.click(screen.getByLabelText("192.168.0.0/16"));
    await tick();
    expect(save).toHaveBeenLastCalledWith("q2", { optionIds: ["c", "e"] });
    fireEvent.click(screen.getByLabelText("10.0.0.0/8"));
    await tick();
    expect(save).toHaveBeenLastCalledWith("q2", { optionIds: ["e"] });
  });

  it("saves typed text after a pause, and at once when leaving the box", async () => {
    const { save } = setup();
    const box = screen.getByLabelText("Your answer to question 3");
    fireEvent.change(box, { target: { value: "domain" } });
    fireEvent.change(box, { target: { value: "domain name system" } });
    await tick(500);
    expect(save).not.toHaveBeenCalled();
    await tick(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("q3", { text: "domain name system" });

    fireEvent.change(box, { target: { value: "dns" } });
    fireEvent.blur(box);
    await tick();
    expect(save).toHaveBeenLastCalledWith("q3", { text: "dns" });
  });

  it("re-syncs the countdown to the server's clock after a save", async () => {
    setup({ remainingMs: 65_000, save: async () => ({ ok: true, remainingMs: 10_000 }) });
    expect(timer()).toBe("01:05");
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(timer()).toBe("00:10"); // the server said 10s, whatever this device thought
  });

  it("keeps the answer and tries again when the network fails", async () => {
    let calls = 0;
    const { save } = setup({
      save: async () => {
        if (++calls === 1) throw new Error("offline");
        return { ok: true, remainingMs: 600_000 };
      },
    });
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(screen.getByText("Some answers are not saved yet. Trying again…")).toBeTruthy();
    await tick(3_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByText("All answers saved")).toBeTruthy();
  });

  it("shows the server's reason when an answer is refused", async () => {
    setup({ save: async () => ({ ok: false, error: "That answer could not be read.", final: false }) });
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(screen.getAllByText("That answer could not be read.").length).toBeGreaterThan(0);
  });

  it("locks the quiz when the server says the attempt is closed", async () => {
    setup({ save: async () => ({ ok: false, error: "Time is up", final: true }) });
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    expect(screen.getByText(/This attempt has closed: Time is up/)).toBeTruthy();
    // The inputs sit in a disabled <fieldset>, which browsers treat as disabled (":disabled").
    expect(screen.getByLabelText("Data link").matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Submit quiz" }).matches(":disabled")).toBe(true);
  });

  it("hands in automatically when the time runs out, with every answer", async () => {
    // A server with a fixed deadline: what it reports shrinks as time passes.
    const deadline = Date.now() + 3_000;
    const { submit } = setup({
      remainingMs: 3_000,
      save: async () => ({ ok: true, remainingMs: deadline - Date.now() }),
    });
    fireEvent.click(screen.getByLabelText("Network"));
    fireEvent.change(screen.getByLabelText("Your answer to question 3"), { target: { value: "dns" } });
    await tick(2_000);
    expect(submit).not.toHaveBeenCalled();
    await tick(1_200);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ q1: { optionIds: ["b"] }, q3: { text: "dns" } });
    expect(screen.getByText("Time is up. Handing in your answers…")).toBeTruthy();
    await tick(10_000);
    expect(submit).toHaveBeenCalledTimes(1); // never twice
  });

  it("submits at once if the page loads after the time is already up", async () => {
    const { submit } = setup({ remainingMs: -2_000 });
    await tick();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("asks for confirmation, mentioning unanswered questions, then submits once", async () => {
    const { submit } = setup();
    fireEvent.click(screen.getByLabelText("Network"));
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    expect(screen.getByText(/You have 2 unanswered questions/)).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();

    const yes = screen.getByRole("button", { name: "Yes, submit" });
    fireEvent.click(yes);
    fireEvent.click(yes); // a double click
    await tick();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ q1: { optionIds: ["b"] } });
  });

  it("lets the student go back and keep working", async () => {
    const { submit } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep working" }));
    expect(screen.getByRole("button", { name: "Submit quiz" })).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it("uses different wording when everything is answered", () => {
    setup({ initial: { q1: { optionIds: ["b"] }, q2: { optionIds: ["c"] }, q3: { text: "dns" } } });
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    expect(screen.getByText(/Hand in your answers now\?/)).toBeTruthy();
  });

  it("retries a submit when the network is down, and stops once it goes through", async () => {
    let calls = 0;
    const { submit } = setup({
      submit: async () => {
        if (++calls < 3) throw new Error("offline");
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, submit" }));
    await tick();
    expect(screen.getByText("Could not reach the server. Trying again…")).toBeTruthy();
    await tick(3_000);
    await tick(3_000);
    expect(submit).toHaveBeenCalledTimes(3);
    await tick(20_000);
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("shows a refusal from the server and allows another try", async () => {
    setup({ submit: async () => ({ ok: false, error: "Attempt not found" }) });
    fireEvent.click(screen.getByRole("button", { name: "Submit quiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, submit" }));
    await tick();
    expect(screen.getByText("Attempt not found")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit quiz" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
