import type { Answer, SaveResult } from "@/features/student/types";

export type SaveState = "saving" | "saved" | "error";

export type SaveQueueEvents = {
  state(itemId: string, state: SaveState, message?: string): void;
  /** The server's time left (its own clock), for re-syncing the countdown. */
  remaining(ms: number): void;
  /** The attempt can no longer take answers (submitted, or time is up). */
  closed(message: string): void;
};

type Send = (itemId: string, answer: Answer) => Promise<SaveResult>;

/**
 * Sends answers to the server as they change, one request at a time per question.
 *  - Text is saved a moment after typing stops; choices are saved at once.
 *  - Only the newest answer for a question is sent (older, unsent ones are dropped).
 *  - A failed request is retried until it goes through, so a bad connection does not lose an answer.
 *  - A rejected answer (the server said no) is not retried; the student has to change it.
 */
export class SaveQueue {
  private unsent = new Map<string, Answer>();
  private inFlight = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;
  private closed = false;

  constructor(
    private send: Send,
    private events: SaveQueueEvents,
    private timing = { debounceMs: 700, retryMs: 3000 },
  ) {}

  /** Records the newest answer for a question and schedules it to be saved. */
  update(itemId: string, answer: Answer, when: "now" | "soon") {
    this.unsent.set(itemId, answer);
    this.clearTimer(itemId);
    if (when === "now") {
      void this.run(itemId);
    } else {
      this.timers.set(
        itemId,
        setTimeout(() => {
          this.timers.delete(itemId);
          void this.run(itemId);
        }, this.timing.debounceMs),
      );
    }
  }

  /** Sends anything waiting straight away (leaving a field, or just before submitting). */
  flush() {
    for (const itemId of [...this.unsent.keys()]) {
      this.clearTimer(itemId);
      void this.run(itemId);
    }
  }

  /** True while any answer is waiting to be sent or being sent. */
  get busy() {
    return this.unsent.size > 0 || this.inFlight.size > 0;
  }

  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private clearTimer(itemId: string) {
    const timer = this.timers.get(itemId);
    if (timer) clearTimeout(timer);
    this.timers.delete(itemId);
  }

  private async run(itemId: string) {
    if (this.disposed || this.closed || this.inFlight.has(itemId)) return;
    const answer = this.unsent.get(itemId);
    if (!answer) return;

    this.unsent.delete(itemId);
    this.inFlight.add(itemId);
    this.events.state(itemId, "saving");

    let retry = false;
    try {
      const result = await this.send(itemId, answer);
      if (this.disposed) return;
      if (result.ok) {
        this.events.remaining(result.remainingMs);
        if (!this.unsent.has(itemId)) this.events.state(itemId, "saved");
      } else if (result.final) {
        this.closed = true;
        this.events.closed(result.error);
      } else {
        this.events.state(itemId, "error", result.error);
      }
    } catch {
      // Network trouble: keep the answer (unless a newer one has replaced it) and try again.
      if (!this.unsent.has(itemId)) this.unsent.set(itemId, answer);
      this.events.state(itemId, "error", "Not saved yet. Trying again…");
      retry = true;
    } finally {
      this.inFlight.delete(itemId);
    }

    if (this.disposed || this.closed) return;
    if (retry) {
      if (!this.timers.has(itemId)) {
        this.timers.set(
          itemId,
          setTimeout(() => {
            this.timers.delete(itemId);
            void this.run(itemId);
          }, this.timing.retryMs),
        );
      }
    } else if (this.unsent.has(itemId) && !this.timers.has(itemId)) {
      void this.run(itemId); // a newer answer arrived while this one was being saved
    }
  }
}
