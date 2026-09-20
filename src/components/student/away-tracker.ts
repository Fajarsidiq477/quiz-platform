import type { AwayReason } from "@/features/attempts/away";
import type { AwayResult } from "@/features/student/types";

/** What the browser says about the quiz page right now. */
export type Environment = {
  /** The tab is in the background, or the window is minimised. */
  hidden: boolean;
  /** The window has keyboard focus (false when another window is in front). */
  focused: boolean;
  fullscreen: boolean;
  /** Leaving full screen only counts once the student has entered it. */
  requireFullscreen: boolean;
};

/** Why the student is away, or null if they are on the page. Hidden wins over the others. */
export function awayReasonOf(env: Environment): AwayReason | null {
  if (env.hidden) return "hidden";
  if (!env.focused) return "blur";
  if (env.requireFullscreen && !env.fullscreen) return "fullscreen";
  return null;
}

export type AwayView = {
  away: boolean;
  /** Times away so far, and how long in total: shown to the student as a deterrent only. */
  count: number;
  totalMs: number;
};

type Report = {
  away(reason: AwayReason): Promise<AwayResult>;
  back(): Promise<AwayResult>;
};

type Op = { kind: "away"; reason: AwayReason } | { kind: "back" };

/**
 * Turns what the browser says about the page into "I left" and "I am back" reports.
 *  - Losing focus or leaving full screen is only reported if it lasts `graceMs`: entering full
 *    screen makes the browser flicker focus for a moment, and that is not leaving. A hidden tab is
 *    reported at once.
 *  - Reports go out in order, one at a time, and a failed one is retried until it goes through, so
 *    a bad connection does not lose a period. Once the server says the attempt is over, it stops.
 *  - The server stamps both moments with its own clock. The counts and seconds kept here (from
 *    `performance.now()`, which ignores the device's date) are only what the student is shown.
 */
export class AwayTracker {
  private latest: AwayReason | null = null;
  private away = false;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private candidateSince = 0;
  private awaySince = 0;
  private count = 0;
  private totalMs = 0;

  private outbox: Op[] = [];
  private sending = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private report: Report,
    private onChange: (view: AwayView) => void,
    private timing = { graceMs: 1000, retryMs: 3000 },
    private now: () => number = () => performance.now(),
  ) {}

  /** Call with the current state whenever visibility, focus or full screen may have changed. */
  update(env: Environment) {
    if (this.stopped) return;
    this.latest = awayReasonOf(env);

    if (this.latest === null) {
      this.clearPending();
      if (this.away) this.comeBack();
      return;
    }
    if (this.away) return;

    // A hidden tab is unmistakable and never flickers, so it is reported at once. That also matters
    // on phones, which can freeze a background tab within seconds.
    if (this.latest === "hidden") {
      if (!this.pending) this.candidateSince = this.now();
      this.clearPending();
      this.goAway("hidden");
      return;
    }
    if (this.pending) return; // waiting to be sure

    this.candidateSince = this.now();
    this.pending = setTimeout(() => {
      this.pending = null;
      // Still away after the grace period? (`latest` is the newest state, not the first.)
      if (!this.stopped && this.latest !== null && !this.away) this.goAway(this.latest);
    }, this.timing.graceMs);
  }

  dispose() {
    this.stopped = true;
    this.clearPending();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private goAway(reason: AwayReason) {
    this.away = true;
    this.awaySince = this.candidateSince;
    this.count += 1;
    this.emit();
    this.enqueue({ kind: "away", reason });
  }

  private comeBack() {
    this.away = false;
    this.totalMs += this.now() - this.awaySince;
    this.emit();
    this.enqueue({ kind: "back" });
  }

  private clearPending() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
  }

  private emit() {
    this.onChange({ away: this.away, count: this.count, totalMs: this.totalMs });
  }

  private enqueue(op: Op) {
    this.outbox.push(op);
    if (!this.retryTimer) void this.pump(); // otherwise the pending retry sends it, in order
  }

  private async pump() {
    if (this.sending || this.stopped) return;
    this.sending = true;
    try {
      while (this.outbox.length > 0 && !this.stopped) {
        const op = this.outbox[0];
        let result: AwayResult;
        try {
          result = op.kind === "away" ? await this.report.away(op.reason) : await this.report.back();
        } catch {
          // Network trouble: keep it, and try again in a moment (order is preserved).
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.pump();
          }, this.timing.retryMs);
          return;
        }
        if (!result.ok && result.final) {
          this.stopped = true; // the attempt is over: nothing more to record
          this.outbox = [];
          return;
        }
        this.outbox.shift(); // sent, or refused for a reason that a retry will not fix
      }
    } finally {
      this.sending = false;
    }
  }
}
