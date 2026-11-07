// Owns: the discussion_post and announcement tables, meaning what class members write to each other on a discussion step and what teachers post to the whole class. Not here: the rules for writing and reading them (src/server/discussions.ts, src/server/announcements.ts).

import { type AnyPgColumn, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "#/db/auth-schema.gen";
import { classTable } from "#/db/class-schema";
import { step } from "#/db/content-schema";
import type { AnnouncementId, ClassId, PostId, StepId, UserId } from "#/db/ids";

// A post with no parent starts a thread. A reply's parent is always a thread starter on the same
// step, so threads are one level deep. src/server/discussions.ts enforces that.
// Deleting is soft (deletedAt), so replies keep their thread. Only a hard delete of the step or
// the user removes rows.
export const discussionPost = pgTable(
	"discussion_post",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<PostId>(),
		stepId: uuid("step_id")
			.notNull()
			.references(() => step.id, { onDelete: "cascade" })
			.$type<StepId>(),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UserId>(),
		parentId: uuid("parent_id")
			.references((): AnyPgColumn => discussionPost.id, { onDelete: "cascade" })
			.$type<PostId>(),
		body: text("body").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		editedAt: timestamp("edited_at"),
		deletedAt: timestamp("deleted_at"),
	},
	(t) => [
		index("discussion_post_step_id_idx").on(t.stepId),
		// Deleting a user cascades here by author_id, and a parent's delete by parent_id.
		index("discussion_post_author_id_idx").on(t.authorId),
		index("discussion_post_parent_id_idx").on(t.parentId),
	],
);

export const announcement = pgTable(
	"announcement",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<AnnouncementId>(),
		classId: uuid("class_id")
			.notNull()
			.references(() => classTable.id, { onDelete: "cascade" })
			.$type<ClassId>(),
		authorId: text("author_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UserId>(),
		body: text("body").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		editedAt: timestamp("edited_at"),
	},
	(t) => [
		index("announcement_class_id_idx").on(t.classId),
		index("announcement_author_id_idx").on(t.authorId),
	],
);
