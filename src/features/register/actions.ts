"use server";

// PUBLIC on purpose: this is the one action that must work for someone who is not signed in, so
// it does not call requireUser(). What keeps strangers out is the class join code, checked in
// registerStudent. It is listed as an explicit exception in tests/admin/actions-are-protected.test.ts.

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getDb } from "@/db";
import { ServiceError } from "../errors";
import { fieldErrorsFrom, formValue, type FormState } from "../form-state";
import { registerInputSchema } from "./schemas";
import { registerStudent } from "./service";

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerInputSchema.safeParse({
    name: formValue(formData, "name"),
    email: formValue(formData, "email"),
    password: formValue(formData, "password"),
    confirmPassword: formValue(formData, "confirmPassword"),
    code: formValue(formData, "code"),
  });
  if (!parsed.success) {
    return {
      error: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  try {
    await registerStudent(getDb(), parsed.data);
  } catch (error) {
    if (error instanceof ServiceError) {
      // Show the problem next to the field the visitor can fix.
      const field = error.code === "not_found" ? "code" : "email";
      return { fieldErrors: { [field]: error.message } };
    }
    throw error;
  }

  // Sign the new student straight in. A successful sign-in redirects by throwing, so only
  // AuthError may be caught here.
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?notice=registered");
    throw error;
  }
  return null;
}
