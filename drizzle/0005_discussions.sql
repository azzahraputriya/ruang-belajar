ALTER TYPE "public"."step_kind" ADD VALUE 'discussion';--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "discussion_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_post" ADD CONSTRAINT "discussion_post_step_id_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_post" ADD CONSTRAINT "discussion_post_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_post" ADD CONSTRAINT "discussion_post_parent_id_discussion_post_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."discussion_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_class_id_idx" ON "announcement" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "announcement_author_id_idx" ON "announcement" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "discussion_post_step_id_idx" ON "discussion_post" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "discussion_post_author_id_idx" ON "discussion_post" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "discussion_post_parent_id_idx" ON "discussion_post" USING btree ("parent_id");