import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Tenant root. It is the only core table without a `school_id` column (it *is* the school). */
export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
