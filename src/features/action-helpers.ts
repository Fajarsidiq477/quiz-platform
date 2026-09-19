import { redirect } from "next/navigation";
import type { AuthUser } from "@/auth/sign-in-policy";
import { ServiceError, type Ctx } from "./errors";
import type { FormState } from "./form-state";

export function ctxOf(user: AuthUser): Ctx {
  return { schoolId: user.schoolId, userId: user.id };
}

/**
 * Runs a mutation and then redirects to the path it returns. A `ServiceError` becomes an inline
 * form error; anything else is a real bug and is rethrown. The redirect is outside the try block
 * on purpose: `redirect()` works by throwing, and must not be caught.
 */
export async function runAction(work: () => Promise<string>): Promise<FormState> {
  let destination: string;
  try {
    destination = await work();
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
  redirect(destination);
}
