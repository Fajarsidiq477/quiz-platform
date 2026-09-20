import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AwayTracker, awayReasonOf, type AwayView, type Environment } from "@/components/student/away-tracker";
import type { AwayResult } from "@/features/student/types";

const ON_PAGE: Environment = { hidden: false, focused: true, fullscreen: true, requireFullscreen: true };
const env = (over: Partial<Environment> = {}): Environment => ({ ...ON_PAGE, ...over });

describe("awayReasonOf", () => {
  it("is null on the page, and names the reason otherwise (hidden first)", () => {
    expect(awayReasonOf(ON_PAGE)).toBeNull();
    expect(awayReasonOf(env({ hidden: true }))).toBe("hidden");
    expect(awayReasonOf(env({ focused: false }))).toBe("blur");
    expect(awayReasonOf(env({ fullscreen: false }))).toBe("fullscreen");
    expect(awayReasonOf(env({ hidden: true, focused: false, fullscreen: false }))).toBe("hidden");
  });

  it("ignores full screen until the student has entered it", () => {
    expect(awayReasonOf(env({ fullscreen: false, requireFullscreen: false }))).toBeNull();
  });
});

describe("AwayTracker", () => {
  let clock = 0;
  let calls: string[];
  let views: AwayView[];
  let tracker: AwayTracker;

  const ok: AwayResult = { ok: true };
  const advance = async (ms: number) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  const last = () => views.at(-1);

  function make(over: { away?: () => Promise<AwayResult>; back?: () => Promise<AwayResult> } = {}) {
    tracker = new AwayTracker(
      {
        away: async (reason) => {
          calls.push(`away:${reason}`);
          return over.away ? over.away() : ok;
        },
        back: async () => {
          calls.push("back");
          return over.back ? over.back() : ok;
        },
      },
      (view) => views.push(view),
      { graceMs: 1000, retryMs: 3000 },
      () => clock,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    calls = [];
    views = [];
    make();
  });
  afterEach(() => {
    tracker.dispose();
    vi.useRealTimers();
  });

  it("reports a hidden tab at once, and the return", async () => {
    tracker.update(env({ hidden: true }));
    await advance(0);
    expect(calls).toEqual(["away:hidden"]);
    expect(last()).toEqual({ away: true, count: 1, totalMs: 0 });

    await advance(12_000);
    tracker.update(ON_PAGE);
    await advance(0);
    expect(calls).toEqual(["away:hidden", "back"]);
    expect(last()).toEqual({ away: false, count: 1, totalMs: 12_000 });
  });

  it("ignores losing focus for less than the grace period", async () => {
    tracker.update(env({ focused: false }));
    await advance(600);
    tracker.update(ON_PAGE);
    await advance(5000);
    expect(calls).toEqual([]);
    expect(views).toEqual([]);
  });

  it("reports losing focus that lasts, counting from when it began", async () => {
    tracker.update(env({ focused: false }));
    await advance(1000);
    expect(calls).toEqual(["away:blur"]);

    await advance(4000);
    tracker.update(ON_PAGE);
    await advance(0);
    expect(calls).toEqual(["away:blur", "back"]);
    expect(last()).toEqual({ away: false, count: 1, totalMs: 5000 });
  });

  it("turns into 'hidden' when the tab is switched after focus was lost, as one absence", async () => {
    tracker.update(env({ focused: false })); // alt-tab: focus goes first
    await advance(200);
    tracker.update(env({ focused: false, hidden: true })); // then the page is hidden
    await advance(0);
    expect(calls).toEqual(["away:hidden"]);

    await advance(3000);
    tracker.update(ON_PAGE);
    await advance(0);
    expect(calls).toEqual(["away:hidden", "back"]);
    expect(last()).toMatchObject({ count: 1, totalMs: 3200 });
  });

  it("counts leaving full screen only after it was entered", async () => {
    tracker.update(env({ fullscreen: false, requireFullscreen: false }));
    await advance(5000);
    expect(calls).toEqual([]);

    tracker.update(env({ fullscreen: false })); // entered earlier, now out
    await advance(1000);
    expect(calls).toEqual(["away:fullscreen"]);
    tracker.update(ON_PAGE);
    await advance(0);
    expect(calls).toEqual(["away:fullscreen", "back"]);
  });

  it("adds up several absences", async () => {
    for (const seconds of [10, 20, 30]) {
      tracker.update(env({ hidden: true }));
      await advance(seconds * 1000);
      tracker.update(ON_PAGE);
      await advance(1000);
    }
    expect(calls).toEqual(["away:hidden", "back", "away:hidden", "back", "away:hidden", "back"]);
    expect(last()).toEqual({ away: false, count: 3, totalMs: 60_000 });
  });

  it("does not report the same state twice", async () => {
    tracker.update(env({ hidden: true }));
    tracker.update(env({ hidden: true }));
    tracker.update(env({ hidden: true, focused: false }));
    await advance(3000);
    expect(calls).toEqual(["away:hidden"]);
    tracker.update(ON_PAGE);
    tracker.update(ON_PAGE);
    await advance(0);
    expect(calls).toEqual(["away:hidden", "back"]);
  });

  it("keeps a report that fails and retries it, in order", async () => {
    let failures = 2;
    make({
      away: async () => {
        if (failures-- > 0) throw new Error("offline");
        return ok;
      },
    });
    tracker.update(env({ hidden: true }));
    await advance(0);
    tracker.update(ON_PAGE); // the student is back while the first report is still failing
    await advance(0);
    expect(calls).toEqual(["away:hidden"]); // 'back' waits behind it

    await advance(3000); // retry fails again
    expect(calls).toEqual(["away:hidden", "away:hidden"]);
    await advance(3000); // retry succeeds, then 'back' follows
    expect(calls).toEqual(["away:hidden", "away:hidden", "away:hidden", "back"]);
  });

  it("stops for good once the server says the attempt is over", async () => {
    make({ away: async () => ({ ok: false, final: true }) });
    tracker.update(env({ hidden: true }));
    await advance(0);
    expect(calls).toEqual(["away:hidden"]);

    tracker.update(ON_PAGE);
    tracker.update(env({ hidden: true }));
    await advance(10_000);
    expect(calls).toEqual(["away:hidden"]);
  });

  it("drops a refusal that is not final instead of retrying it forever", async () => {
    make({ away: async () => ({ ok: false, final: false }) });
    tracker.update(env({ hidden: true }));
    await advance(10_000);
    expect(calls).toEqual(["away:hidden"]);
  });

  it("sends nothing after it is disposed", async () => {
    tracker.update(env({ focused: false }));
    tracker.dispose();
    await advance(5000);
    tracker.update(env({ hidden: true }));
    await advance(5000);
    expect(calls).toEqual([]);
  });
});
