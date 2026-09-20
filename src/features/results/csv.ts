import type { QuizResults, ResultRow } from "./service";

// A spreadsheet treats a cell that starts with = + - @ (or a tab or carriage return) as a formula,
// so a student who registered with the name "=HYPERLINK(...)" could make a teacher's spreadsheet do
// something when the export is opened. Such text cells get a leading apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const round = (n: number) => Math.round(n * 100) / 100;

function statusText(row: ResultRow): string {
  if (row.state === "not_started") return "Not started";
  const finished = row.latest ? (row.latest.timedOut ? "Finished (time ran out)" : "Finished") : "";
  if (row.state === "in_progress") return row.latest ? `In progress (earlier result shown)` : "In progress";
  return finished;
}

/**
 * The results table as CSV: one row per student with the latest finished attempt's score, how often
 * and for how long they left the quiz page, then the points awarded for each question. Times are ISO 8601 in UTC, so they mean the same anywhere.
 * The BOM makes Excel read it as UTF-8, so names with accents survive.
 */
export function buildResultsCsv(results: QuizResults): string {
  const header = [
    "Student",
    "Email",
    "Status",
    "Attempts used",
    "Result from attempt",
    "Score",
    "Max score",
    "Percent",
    "Submitted (UTC)",
    "Times away",
    "Seconds away",
    ...results.items.map((item, i) => `Q${i + 1} (${item.points} pts)`),
  ];

  const lines = [header, ...results.rows.map((row) => [
    row.name,
    row.email,
    statusText(row),
    row.attemptsUsed,
    row.latest?.attemptNo ?? null,
    row.latest ? round(row.latest.score) : null,
    row.latest ? round(row.latest.maxScore) : null,
    row.latest ? round(row.latest.percent) : null,
    row.latest?.submittedAt ? row.latest.submittedAt.toISOString() : null,
    // Blank, not 0, when it was not recorded: 0 would say the student never left.
    row.away?.tracked ? row.away.count : null,
    row.away?.tracked ? Math.round(row.away.totalMs / 1000) : null,
    ...results.items.map((item) => (row.latest ? round(row.points[item.id] ?? 0) : null)),
  ])];

  return "﻿" + lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A safe file name: "Quiz: Week 3/4" -> "results-quiz-week-3-4.csv". */
export function csvFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
  return `results-${slug || "quiz"}.csv`;
}
