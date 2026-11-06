CREATE TYPE "public"."class_role" AS ENUM('teacher', 'student');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TABLE "class_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"invitee_id" text NOT NULL,
	"invited_by_id" text NOT NULL,
	"role" "class_role" NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "class_member" (
	"class_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "class_role" NOT NULL,
	"ai_consent_at" timestamp,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "class_member_class_id_user_id_pk" PRIMARY KEY("class_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"subject" text NOT NULL,
	"ai_tutor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_invite" ADD CONSTRAINT "class_invite_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_invite" ADD CONSTRAINT "class_invite_invitee_id_user_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_invite" ADD CONSTRAINT "class_invite_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_member" ADD CONSTRAINT "class_member_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_member" ADD CONSTRAINT "class_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_invite_one_pending_idx" ON "class_invite" USING btree ("class_id","invitee_id") WHERE "class_invite"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "class_invite_invitee_id_idx" ON "class_invite" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "class_member_user_id_idx" ON "class_member" USING btree ("user_id");