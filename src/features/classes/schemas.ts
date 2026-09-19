import { z } from "zod";

export const classInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Use at most 100 characters"),
  term: z.string().trim().min(1, "Term is required").max(50, "Use at most 50 characters"),
});

export type ClassInput = z.infer<typeof classInputSchema>;
