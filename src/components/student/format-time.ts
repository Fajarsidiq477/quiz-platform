/** "1:05:09" for an hour or more, otherwise "05:09". Negative values show as zero. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export type TimerState = "normal" | "warning" | "danger" | "over";

/** Under 5 minutes is a warning, under 1 minute is urgent. */
export function timerState(ms: number): TimerState {
  if (ms <= 0) return "over";
  if (ms <= 60_000) return "danger";
  if (ms <= 5 * 60_000) return "warning";
  return "normal";
}
