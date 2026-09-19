import { foreignKey, index, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, schoolId } from "./_columns";
import { users } from "./people";

/**
 * Makes any POST safely replayable (start attempt, final submit). Flow: insert the key with a null
 * `response` (ON CONFLICT DO NOTHING); if it already existed, compare `request_hash` (mismatch =
 * key reused for a different request) and return the stored `response` once it is set.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    schoolId: schoolId(),
    userId: uuid("user_id").notNull(),
    key: uuid("key").notNull(),
    requestHash: text("request_hash").notNull(),
    /** Null while the original request is still in flight. */
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "idempotency_keys_pk", columns: [t.schoolId, t.userId, t.key] }),
    foreignKey({
      name: "idempotency_keys_user_fk",
      columns: [t.userId, t.schoolId],
      foreignColumns: [users.id, users.schoolId],
    }).onDelete("restrict"),
    // For purging old keys.
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);
