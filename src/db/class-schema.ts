// Owns: the class, class_member, and class_invite tables. Not here: the rules for changing them (src/server/classes.ts).

import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "#/db/auth-schema.gen";
import type { ClassId, InviteId, UserId } from "#/db/ids";

export const classRole = pgEnum("class_role", ["teacher", "student"]);
export type ClassRole = (typeof classRole.enumValues)[number];

export const inviteStatus = pgEnum("invite_status", ["pending", "accepted", "declined", "revoked"]);
export type InviteStatus = (typeof inviteStatus.enumValues)[number];

export const classTable = pgTable("class", {
	id: uuid("id").primaryKey().defaultRandom().$type<ClassId>(),
	title: text("title").notNull(),
	subject: text("subject").notNull(),
	aiTutorEnabled: boolean("ai_tutor_enabled").default(false).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

const userRef = (name: string) =>
	text(name)
		.notNull()
		.references(() => user.id, { onDelete: "cascade" })
		.$type<UserId>();

const classRef = () =>
	uuid("class_id")
		.notNull()
		.references(() => classTable.id, { onDelete: "cascade" })
		.$type<ClassId>();

export const classMember = pgTable(
	"class_member",
	{
		classId: classRef(),
		userId: userRef("user_id"),
		role: classRole("role").notNull(),
		aiConsentAt: timestamp("ai_consent_at"),
		joinedAt: timestamp("joined_at").defaultNow().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.classId, t.userId] }),
		index("class_member_user_id_idx").on(t.userId),
	],
);

export const classInvite = pgTable(
	"class_invite",
	{
		id: uuid("id").primaryKey().defaultRandom().$type<InviteId>(),
		classId: classRef(),
		inviteeId: userRef("invitee_id"),
		invitedById: userRef("invited_by_id"),
		role: classRole("role").notNull(),
		status: inviteStatus("status").default("pending").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		respondedAt: timestamp("responded_at"),
	},
	(t) => [
		// Closed invites stay as history, so only pending ones must be unique.
		uniqueIndex("class_invite_one_pending_idx")
			.on(t.classId, t.inviteeId)
			.where(sql`${t.status} = 'pending'`),
		index("class_invite_invitee_id_idx").on(t.inviteeId),
	],
);
