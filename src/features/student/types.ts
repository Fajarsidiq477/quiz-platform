/** What the browser gets back after saving one answer. */
export type SaveResult =
  | { ok: true; remainingMs: number }
  // `final` means the attempt can no longer accept answers (submitted, or time is up).
  | { ok: false; error: string; final: boolean };

/** What the browser gets back if a submit does not end in a redirect to the result. */
export type SubmitResult = { ok: false; error: string };

/** One saved answer as the browser holds it. */
export type Answer = { optionIds: string[] } | { text: string };
