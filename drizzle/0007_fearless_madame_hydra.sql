CREATE TABLE "attempt_away_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "attempt_away_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "attempt_away_reason_ck" CHECK ("attempt_away_periods"."reason" in ('hidden', 'blur', 'fullscreen')),
	CONSTRAINT "attempt_away_ended_ck" CHECK ("attempt_away_periods"."ended_at" is null or "attempt_away_periods"."ended_at" >= "attempt_away_periods"."started_at")
);
--> statement-breakpoint
ALTER TABLE "attempt_away_periods" ADD CONSTRAINT "attempt_away_periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_away_periods" ADD CONSTRAINT "attempt_away_attempt_fk" FOREIGN KEY ("attempt_id","school_id") REFERENCES "public"."attempts"("id","school_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_away_one_open_uq" ON "attempt_away_periods" USING btree ("attempt_id") WHERE "attempt_away_periods"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "attempt_away_attempt_idx" ON "attempt_away_periods" USING btree ("attempt_id","started_at");