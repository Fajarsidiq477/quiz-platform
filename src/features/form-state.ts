import { z } from "zod";

/**
 * What a form action returns when it does not redirect. `null` = nothing submitted yet. `details`
 * is a list of specifics under the main error (the rows of an imported file that need fixing).
 */
export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  details?: string[];
} | null;

/** First message per field, from a failed Zod parse. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const { fieldErrors } = z.flattenError(error);
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0];
    if (first) out[key] = first;
  }
  return out;
}

export function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
