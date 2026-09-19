CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'submitted', 'expired', 'graded');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('single_choice', 'multiple_choice', 'true_false', 'short_answer');--> statement-breakpoint
CREATE TYPE "public"."quiz_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."results_visibility" AS ENUM('never', 'after_submit', 'after_close');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'teacher', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"quiz_question_id" uuid NOT NULL,
	"response" jsonb NOT NULL,
	"is_correct" boolean,
	"points_awarded" numeric(6, 2),
	"graded_by" uuid,
	"feedback" text,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_attempt_question_uq" UNIQUE("attempt_id","quiz_question_id"),
	CONSTRAINT "answers_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "answers_points_ck" CHECK ("answers"."points_awarded" is null or "answers"."points_awarded" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"score" numeric(8, 2),
	"max_score" numeric(8, 2),
	"graded_at" timestamp with time zone,
	CONSTRAINT "attempts_quiz_student_no_uq" UNIQUE("quiz_id","student_id","attempt_no"),
	CONSTRAINT "attempts_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "attempts_id_quiz_school_uq" UNIQUE("id","quiz_id","school_id"),
	CONSTRAINT "attempts_attempt_no_ck" CHECK ("attempts"."attempt_no" >= 1),
	CONSTRAINT "attempts_deadline_ck" CHECK ("attempts"."deadline_at" > "attempts"."started_at"),
	CONSTRAINT "attempts_submitted_ck" CHECK ("attempts"."submitted_at" is null or "attempts"."submitted_at" >= "attempts"."started_at")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("school_id","user_id","key")
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"name" text NOT NULL,
	"term" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_school_term_name_uq" UNIQUE("school_id","term","name"),
	CONSTRAINT "classes_id_school_uq" UNIQUE("id","school_id")
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_class_student_uq" UNIQUE("class_id","student_id"),
	CONSTRAINT "enrollments_id_school_uq" UNIQUE("id","school_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_uq" UNIQUE("email"),
	CONSTRAINT "users_id_school_uq" UNIQUE("id","school_id")
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"question_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	CONSTRAINT "question_options_version_position_uq" UNIQUE("question_version_id","position"),
	CONSTRAINT "question_options_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "question_options_position_ck" CHECK ("question_options"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"type" "question_type" NOT NULL,
	"prompt" text NOT NULL,
	"default_points" numeric(6, 2) DEFAULT '1' NOT NULL,
	"accepted_answers" jsonb,
	"explanation" text,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_versions_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "question_versions_version_no_ck" CHECK ("question_versions"."version_no" >= 1),
	CONSTRAINT "question_versions_points_ck" CHECK ("question_versions"."default_points" >= 0),
	CONSTRAINT "question_versions_accepted_answers_ck" CHECK ("question_versions"."accepted_answers" is null or "question_versions"."type" = 'short_answer')
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"topic" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_id_school_uq" UNIQUE("id","school_id")
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"question_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"points" numeric(6, 2) NOT NULL,
	CONSTRAINT "quiz_questions_quiz_position_uq" UNIQUE("quiz_id","position"),
	CONSTRAINT "quiz_questions_quiz_version_uq" UNIQUE("quiz_id","question_version_id"),
	CONSTRAINT "quiz_questions_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "quiz_questions_id_quiz_school_uq" UNIQUE("id","quiz_id","school_id"),
	CONSTRAINT "quiz_questions_position_ck" CHECK ("quiz_questions"."position" >= 1),
	CONSTRAINT "quiz_questions_points_ck" CHECK ("quiz_questions"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "quiz_status" DEFAULT 'draft' NOT NULL,
	"time_limit_seconds" integer,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"shuffle_questions" boolean DEFAULT false NOT NULL,
	"results_visibility" "results_visibility" DEFAULT 'after_close' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quizzes_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "quizzes_window_ck" CHECK ("quizzes"."opens_at" is null or "quizzes"."closes_at" is null or "quizzes"."opens_at" < "quizzes"."closes_at"),
	CONSTRAINT "quizzes_published_has_window_ck" CHECK ("quizzes"."status" = 'draft' or ("quizzes"."opens_at" is not null and "quizzes"."closes_at" is not null)),
	CONSTRAINT "quizzes_time_limit_ck" CHECK ("quizzes"."time_limit_seconds" is null or "quizzes"."time_limit_seconds" > 0),
	CONSTRAINT "quizzes_max_attempts_ck" CHECK ("quizzes"."max_attempts" >= 1)
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_attempt_fk" FOREIGN KEY ("attempt_id","quiz_id","school_id") REFERENCES "public"."attempts"("id","quiz_id","school_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_quiz_question_fk" FOREIGN KEY ("quiz_question_id","quiz_id","school_id") REFERENCES "public"."quiz_questions"("id","quiz_id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_graded_by_fk" FOREIGN KEY ("graded_by","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_quiz_fk" FOREIGN KEY ("quiz_id","school_id") REFERENCES "public"."quizzes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_student_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_fk" FOREIGN KEY ("user_id","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_fk" FOREIGN KEY ("teacher_id","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_version_fk" FOREIGN KEY ("question_version_id","school_id") REFERENCES "public"."question_versions"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_fk" FOREIGN KEY ("question_id","school_id") REFERENCES "public"."questions"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_created_by_fk" FOREIGN KEY ("created_by","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_fk" FOREIGN KEY ("created_by","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_fk" FOREIGN KEY ("quiz_id","school_id") REFERENCES "public"."quizzes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_version_fk" FOREIGN KEY ("question_version_id","school_id") REFERENCES "public"."question_versions"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_class_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_fk" FOREIGN KEY ("created_by","school_id") REFERENCES "public"."users"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_quiz_question_idx" ON "answers" USING btree ("quiz_question_id");--> statement-breakpoint
CREATE INDEX "answers_ungraded_idx" ON "answers" USING btree ("attempt_id") WHERE "answers"."is_correct" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_one_open_uq" ON "attempts" USING btree ("quiz_id","student_id") WHERE "attempts"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "attempts_open_deadline_idx" ON "attempts" USING btree ("deadline_at") WHERE "attempts"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "attempts_quiz_status_idx" ON "attempts" USING btree ("quiz_id","status");--> statement-breakpoint
CREATE INDEX "attempts_student_started_idx" ON "attempts" USING btree ("student_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "enrollments_student_status_idx" ON "enrollments" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "users_school_role_idx" ON "users" USING btree ("school_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "question_versions_question_version_uq" ON "question_versions" USING btree ("question_id","version_no" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "questions_school_topic_idx" ON "questions" USING btree ("school_id","topic") WHERE "questions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "quiz_questions_version_idx" ON "quiz_questions" USING btree ("question_version_id");--> statement-breakpoint
CREATE INDEX "quizzes_class_status_opens_idx" ON "quizzes" USING btree ("class_id","status","opens_at");