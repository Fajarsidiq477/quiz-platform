ALTER TABLE "classes" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_join_code_uq" UNIQUE("join_code");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_join_code_ck" CHECK ("classes"."join_code" is null or "classes"."join_code" ~ '^[A-HJ-NP-Z2-9]{8}$');