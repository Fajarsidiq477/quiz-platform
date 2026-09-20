// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptRunner } from "@/components/student/attempt-runner";
import type { TakingItem } from "@/features/student/service";
import type { AwayResult } from "@/features/student/types";

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
];

// A stand-in for the parts of the browser the cheating prevention depends on.
let hidden = false;
let focused = true;
let fullscreenEnabled = true;
let fullscreenElement: Element | null = null;
let refuseFullscreen = false;

function installBrowser() {
  hidden = false;
  focused = true;
  fullscreenEnabled = true;
  fullscreenElement = null;
  refuseFullscreen = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => focused });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => fullscreenEnabled });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
  document.documentElement.requestFullscreen = vi.fn(async () => {
    if (refuseFullscreen) throw new Error("not allowed");
    fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  document.exitFullscreen = vi.fn(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

const emit = (target: Document | Window, name: string) =>
  act(async () => {
    target.dispatchEvent(new Event(name));
  });
const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

type AwayFn = (reason: string) => Promise<AwayResult>;

function setup(withIntegrity = true) {
  const away = vi.fn<AwayFn>(async () => ({ ok: true }));
  const back = vi.fn<() => Promise<AwayResult>>(async () => ({ ok: true }));
  const view = render(
    <AttemptRunner
      title="Networking basics"
      description={null}
      items={ITEMS}
      initialAnswers={{}}
      initialRemainingMs={600_000}
      save={async () => ({ ok: true, remainingMs: 600_000 })}
      submit={async () => undefined}
      integrity={withIntegrity ? { away, back } : undefined}
    />,
  );
  return { away, back, ...view };
}

const gate = () => screen.queryByRole("dialog");
const enter = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Enter full screen" }));
  await tick();
};

describe("cheating prevention on the quiz screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    installBrowser();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("full screen", () => {
    it("holds the quiz behind a prompt until the student enters full screen", async () => {
      const { container } = setup();
      await tick();

      expect(gate()).not.toBeNull();
      expect(screen.getByText("Full screen required")).toBeTruthy();
      // The questions cannot be used or read behind the prompt, and the clock keeps running.
      expect(container.querySelector("[inert]")).not.toBeNull();
      expect(screen.getByText(/The clock keeps running/)).toBeTruthy();

      await enter();

      expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(gate()).toBeNull();
      expect(container.querySelector("[inert]")).toBeNull();
    });

    it("brings the prompt back if the student leaves full screen, and reports it", async () => {
      const { away, back } = setup();
      await tick();
      await enter();
      expect(away).not.toHaveBeenCalled(); // getting into full screen is not leaving

      fullscreenElement = null; // Esc
      await emit(document, "fullscreenchange");
      expect(gate()).not.toBeNull();

      await tick(1000); // it lasted longer than a flicker
      expect(away).toHaveBeenCalledWith("fullscreen");

      await enter();
      expect(gate()).toBeNull();
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("lets a student continue when the browser refuses full screen", async () => {
      refuseFullscreen = true;
      setup();
      await tick();
      expect(screen.queryByRole("button", { name: "Continue without full screen" })).toBeNull();

      await enter();
      expect(screen.getByText("Your browser did not allow full screen.")).toBeTruthy();
      expect(gate()).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Continue without full screen" }));
      await tick();
      expect(gate()).toBeNull();
    });

    it("does not hold back a device without full screen, and says so", async () => {
      fullscreenEnabled = false; // iPhone Safari
      const { container } = setup();
      await tick();

      expect(gate()).toBeNull();
      expect(container.querySelector("[inert]")).toBeNull();
      expect(screen.getByText(/Full screen is not available on this device/)).toBeTruthy();
    });

    it("leaves full screen when the quiz screen goes away", async () => {
      const { unmount } = setup();
      await tick();
      await enter();
      unmount();
      await tick();
      expect(document.exitFullscreen).toHaveBeenCalled();
      expect(fullscreenElement).toBeNull();
    });
  });

  describe("time away from the page", () => {
    it("reports switching tab at once, and coming back, and shows the student their count", async () => {
      const { away, back } = setup();
      await tick();
      await enter();

      hidden = true;
      await emit(document, "visibilitychange");
      expect(away).toHaveBeenCalledWith("hidden");

      await tick(12_000);
      hidden = false;
      await emit(document, "visibilitychange");
      expect(back).toHaveBeenCalledTimes(1);

      expect(screen.getByText(/Left the page 1× · 12 s/)).toBeTruthy();
    });

    it("reports another window taking focus once it lasts, and ignores a flicker", async () => {
      const { away, back } = setup();
      await tick();
      await enter();

      focused = false;
      await emit(window, "blur");
      await tick(400);
      focused = true;
      await emit(window, "focus");
      await tick(3000);
      expect(away).not.toHaveBeenCalled();

      focused = false;
      await emit(window, "blur");
      await tick(1000);
      expect(away).toHaveBeenCalledWith("blur");
      focused = true;
      await emit(window, "focus");
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("counts every absence", async () => {
      const { away } = setup();
      await tick();
      await enter();

      for (const seconds of [5, 10]) {
        hidden = true;
        await emit(document, "visibilitychange");
        await tick(seconds * 1000);
        hidden = false;
        await emit(document, "visibilitychange");
      }
      expect(away).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/Left the page 2× · 15 s/)).toBeTruthy();
    });

    it("tells the student it is recorded", async () => {
      setup();
      await tick();
      await enter();
      expect(screen.getByText(/is recorded, with how long you were away/)).toBeTruthy();
    });
  });

  it("does nothing extra when cheating prevention is not switched on", async () => {
    const { away, container } = setup(false);
    await tick();

    expect(gate()).toBeNull();
    expect(container.querySelector("[inert]")).toBeNull();
    hidden = true;
    await emit(document, "visibilitychange");
    await tick(5000);
    expect(away).not.toHaveBeenCalled();
    expect(screen.queryByText(/is recorded/)).toBeNull();
  });
});
