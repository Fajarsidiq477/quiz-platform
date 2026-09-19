import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./drizzle",
  dbCredentials: {
    // Only needed for `db:migrate`; `db:generate` works without a database.
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
