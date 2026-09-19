import { customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { schools } from "./schools";

/** Case-insensitive text (requires the `citext` extension, created in migration 0000). */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const pk = () => uuid("id").primaryKey().defaultRandom();

/** Tenant column. Every core table has one (CLAUDE.md rule 4). */
export const schoolId = () =>
  uuid("school_id")
    .notNull()
    .references(() => schools.id, { onDelete: "restrict" });

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => tstz("created_at").notNull().defaultNow();
