import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCountdown, timerState } from "@/components/student/format-time";
import { SaveQueue } from "@/components/student/save-queue";
import type { Answer, SaveResult } from "@/features/student/types";

describe("formatCountdown / timerState", () => {
  it("formats minutes and hours, rounding partial seconds up", () => {
    expect(formatCountdown(65_000)).toBe("01:05");
    expect(formatCountdown(59_001)).toBe("01:00");
    expect(formatCountdown(3_599_000)).toBe("59:59");
    expect(formatCountdown(3_661_000)).toBe("1:01:01");
    expect(formatCountdown(0)).toBe("00:00");
  });

  it("never shows a negative time", () => {
    expect(formatCountdown(-5_000)).toBe("00:00");
  });

  it("warns under 5 minutes, urgent under 1, over at zero", () => {
    expect(timerState(10 * 60_000)).toBe("normal");
    expect(timerState(5 * 60_000)).toBe("warning");
    expect(timerState(61_000)).toBe("warning");
    expect(timerState(60_000)).toBe("danger");
    expect(timerState(1)).toBe("danger");
    expect(timerState(0)).toBe("over");
    expect(timerState(-1)).toBe("over");
  });
});

describe("SaveQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const a = (n: number): Answer => ({ text: `answer ${n}` });
  const ok = (remainingMs = 60_000): SaveResult => ({ ok: true, remainingMs });

  function setup(send: (id: string, answer: Answer) => Promise<SaveResult>) {
    const log: string[] = [];
    const events = {
      state: vi.fn((id: string, state: string, message?: string) => log.push(`${id}:${state}${message ? `:${message}` : ""}`)),
      remaining: vi.fn(),
      closed: vi.fn(),
    };
    const queue = new SaveQueue(send, events, { debounceMs: 700, retryMs: 3000 });
    return { queue, events, log };
  }

  it("saves a choice at once", async () => {
    const send = vi.fn(async () => ok());
    const { queue, events, log } = setup(send);
    queue.update("q1", { optionIds: ["x"] }, "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledWith("q1", { optionIds: ["x"] });
    expect(log).toEqual(["q1:saving", "q1:saved"]);
    expect(events.remaining).toHaveBeenCalledWith(60_000);
  });

  it("waits for typing to stop, and sends only the newest text", async () => {
    const send = vi.fn(async () => ok());
    const { queue } = setup(send);
    queue.update("q1", a(1), "soon");
    await vi.advanceTimersByTimeAsync(300);
    queue.update("q1", a(2), "soon");
    await vi.advanceTimersByTimeAsync(300);
    queue.update("q1", a(3), "soon");
    await vi.advanceTimersByTimeAsync(699);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("q1", a(3));
  });

  it("flush sends everything waiting immediately", async () => {
    const send = vi.fn(async () => ok());
    const { queue } = setup(send);
    queue.update("q1", a(1), "soon");
    queue.update("q2", a(2), "soon");
    queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2); // the debounce timers were cancelled
  });

  it("never runs two saves of the same question at once, and ends with the newest answer", async () => {
    const releases: (() => void)[] = [];
    const send = vi.fn(
      () =>
        new Promise<SaveResult>((resolve) => releases.push(() => resolve(ok()))),
    );
    const { queue, log } = setup(send);
    queue.update("q1", a(1), "now");
    await vi.advanceTimersByTimeAsync(0);
    queue.update("q1", a(2), "now"); // arrives while #1 is in flight
    queue.update("q1", a(3), "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    releases[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("q1", a(3)); // #2 was superseded
    expect(log).not.toContain("q1:saved"); // not "saved" while a newer answer is waiting

    releases[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.at(-1)).toBe("q1:saved");
  });

  it("different questions save in parallel", async () => {
    const send = vi.fn(() => new Promise<SaveResult>(() => {}));
    const { queue } = setup(send);
    queue.update("q1", a(1), "now");
    queue.update("q2", a(2), "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying a failed save until it goes through, without losing the answer", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      if (++calls < 3) throw new Error("offline");
      return ok();
    });
    const { queue, log } = setup(send);
    queue.update("q1", a(1), "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(log.at(-1)).toMatch(/q1:error/);
    expect(queue.busy).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith("q1", a(1));
    expect(log.at(-1)).toBe("q1:saved");
    expect(queue.busy).toBe(false);
  });

  it("a retry sends the newest answer, not the one that failed", async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      if (++calls === 1) throw new Error("offline");
      return ok();
    });
    const { queue } = setup(send);
    queue.update("q1", a(1), "now");
    await vi.advanceTimersByTimeAsync(0);
    queue.update("q1", a(2), "soon"); // typed more while offline
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenLastCalledWith("q1", a(2));
  });

  it("does not retry an answer the server rejected, and shows its message", async () => {
    const send = vi.fn(async (): Promise<SaveResult> => ({ ok: false, error: "That answer could not be read.", final: false }));
    const { queue, log } = setup(send);
    queue.update("q1", a(1), "now");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(log.at(-1)).toBe("q1:error:That answer could not be read.");
  });

  it("stops everything when the attempt is closed", async () => {
    const send = vi.fn(async (): Promise<SaveResult> => ({ ok: false, error: "Time is up", final: true }));
    const { queue, events } = setup(send);
    queue.update("q1", a(1), "now");
    await vi.advanceTimersByTimeAsync(0);
    expect(events.closed).toHaveBeenCalledWith("Time is up");

    queue.update("q2", a(2), "now");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1); // nothing more is sent
  });

  it("does nothing after dispose", async () => {
    const send = vi.fn(async () => ok());
    const { queue } = setup(send);
    queue.update("q1", a(1), "soon");
    queue.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
  });
});
