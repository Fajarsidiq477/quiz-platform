import { z } from "zod";
import { passwordSchema } from "@/auth/password";
import { isJoinCode, normalizeJoinCode } from "../classes/join-code";

export const registerInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(100, "Use at most 100 characters"),
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
    password: passwordSchema,
    confirmPassword: z.string(),
    // Typed by hand, so be forgiving about case, spaces and a hyphen in the middle.
    code: z
      .string()
      .transform(normalizeJoinCode)
      .pipe(z.string().refine(isJoinCode, "Enter the 8-character class code")),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "The passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.output<typeof registerInputSchema>;
