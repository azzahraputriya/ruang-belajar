CREATE TYPE "public"."question_kind" AS ENUM('single_choice', 'multiple_choice', 'number', 'short_text');--> statement-breakpoint
ALTER TYPE "public"."step_kind" ADD VALUE 'quiz';--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "question_kind" NOT NULL,
	"prompt" text NOT NULL,
	"choices" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"score" integer NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_key" (
	"question_id" uuid PRIMARY KEY NOT NULL,
	"correct" jsonb NOT NULL,
	"feedback" text NOT NULL,
	"solution" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_key" ADD CONSTRAINT "question_key_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_step_id_idx" ON "question" USING btree ("step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempt_step_student_number_idx" ON "quiz_attempt" USING btree ("step_id","student_id","attempt_number");--> statement-breakpoint
CREATE INDEX "quiz_attempt_student_id_idx" ON "quiz_attempt" USING btree ("student_id");