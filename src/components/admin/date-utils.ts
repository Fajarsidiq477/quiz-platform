// Quiz times are entered and shown in the viewer's own time zone, but stored as UTC instants.
// The server does not know the teacher's time zone, so the browser converts: a
// <datetime-local> value ("2026-10-01T08:00", no zone) becomes an ISO instant before it is sent.

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant -> value for a <datetime-local> input, in the browser's time zone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <datetime-local> value (browser time zone) -> ISO instant, or "" if blank or invalid. */
export function localInputToIso(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** ISO instant -> readable text in the browser's time zone and locale. */
export function formatLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
