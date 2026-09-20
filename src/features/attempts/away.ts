// Type-only on purpose: the quiz page in the browser imports `formatAway` from here, and it must
// not pull the database schema into the bundle.
import type { AwayReason } from "@/db/schema";

export type { AwayReason };

/** Words for the teacher's view. */
export const AWAY_REASON_LABELS: Record<AwayReason, string> = {
  hidden: "Switched tab or minimised the window",
  blur: "Clicked into another window",
  fullscreen: "Left full screen",
};

/** One stretch away, as stored: `endedAt` is null while it is open (or if the tab was closed). */
export type AwayPeriod = { reason: AwayReason; startedAt: Date; endedAt: Date | null };

export type AwayEntry = {
  reason: AwayReason;
  startedAt: Date;
  endedAt: Date;
  ms: number;
  /** The student never came back before the attempt ended. */
  neverReturned: boolean;
};

export type AwayStats = {
  count: number;
  totalMs: number;
  longestMs: number;
  entries: AwayEntry[];
};

export const NO_AWAY: AwayStats = { count: 0, totalMs: 0, longestMs: 0, entries: [] };

/**
 * What the teacher is shown for an attempt. `tracked` is false for an attempt started before time
 * away was recorded: it has no records, but that does not mean the student never left.
 */
export type AwayReport = AwayStats & { tracked: boolean };

/**
 * Turns stored periods into what the teacher sees. `until` is when the attempt stopped mattering:
 * its hand-in time (or its deadline if time ran out), or the database's "now" for an attempt still
 * open. A period is cut off there, so a tab left hidden after handing in adds nothing, and a period
 * that never got its end (the tab was closed) counts up to `until`.
 */
export function summariseAway(periods: AwayPeriod[], until: Date): AwayStats {
  const entries: AwayEntry[] = [];
  for (const p of periods) {
    if (p.startedAt.getTime() >= until.getTime()) continue; // began after the attempt was over
    const stopped = p.endedAt !== null && p.endedAt.getTime() <= until.getTime();
    const endedAt = stopped ? p.endedAt! : until;
    entries.push({
      reason: p.reason,
      startedAt: p.startedAt,
      endedAt,
      ms: Math.max(0, endedAt.getTime() - p.startedAt.getTime()),
      neverReturned: !stopped,
    });
  }
  entries.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  return {
    count: entries.length,
    totalMs: entries.reduce((sum, e) => sum + e.ms, 0),
    longestMs: entries.reduce((max, e) => Math.max(max, e.ms), 0),
    entries,
  };
}

/** "45 s", "2 min 05 s", "1 h 03 min". Rounded to whole seconds. */
export function formatAway(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
