CREATE TYPE "public"."submission_action" AS ENUM('submit', 'return', 'grade');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('draft', 'submitted', 'returned', 'graded');--> statement-breakpoint
ALTER TYPE "public"."step_kind" ADD VALUE 'assignment';--> statement-breakpoint
ALTER TYPE "public"."step_kind" ADD VALUE 'reflection';--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"status" "submission_status" DEFAULT 'draft' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp,
	"returned_at" timestamp,
	"graded_at" timestamp,
	"comment" text,
	"score" integer,
	"rubric_scores" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "submission_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"submission_id" uuid NOT NULL,
	"action" "submission_action" NOT NULL,
	"comment" text,
	"score" integer,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"storage_key" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "submission_file_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_event" ADD CONSTRAINT "submission_event_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_file" ADD CONSTRAINT "submission_file_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_step_student_idx" ON "submission" USING btree ("step_id","student_id");--> statement-breakpoint
CREATE INDEX "submission_student_id_idx" ON "submission" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "submission_event_submission_id_idx" ON "submission_event" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_file_submission_id_idx" ON "submission_file" USING btree ("submission_id");