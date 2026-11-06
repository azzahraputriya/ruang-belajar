CREATE TYPE "public"."step_kind" AS ENUM('reading', 'embed');--> statement-breakpoint
CREATE TYPE "public"."visit_event" AS ENUM('opened', 'finished');--> statement-breakpoint
CREATE TABLE "module" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"opens_at" timestamp,
	"due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "step_kind" NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"event" "visit_event" NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "module" ADD CONSTRAINT "module_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step" ADD CONSTRAINT "step_module_id_module_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."module"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_visit" ADD CONSTRAINT "step_visit_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_visit" ADD CONSTRAINT "step_visit_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "module_class_id_idx" ON "module" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "step_module_id_idx" ON "step" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "step_visit_step_student_idx" ON "step_visit" USING btree ("step_id","student_id");--> statement-breakpoint
CREATE INDEX "step_visit_student_id_idx" ON "step_visit" USING btree ("student_id");