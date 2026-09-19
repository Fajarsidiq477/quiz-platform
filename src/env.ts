import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

// Parsed lazily so importing modules (and tests) never require a database URL.
// Auth.js itself reads AUTH_SECRET from the environment.
export function getEnv() {
  return envSchema.parse(process.env);
}
