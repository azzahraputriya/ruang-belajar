// Owns: every class announcement operation (list, create, edit, delete) with its membership check and input rules. Not here: the announcement table (src/db/discussion-schema.ts) or session wiring (src/server/announcement-fns.ts).

import { type } from "arktype";
import { desc, eq } from "drizzle-orm";
import { user } from "#/db/auth-schema.gen";
import { db } from "#/db/client";
import { announcement } from "#/db/discussion-schema";
import type { AnnouncementId, ClassId, UserId } from "#/db/ids";
import { NOT_FOUND, OK, type Tx, fail, lockClass, roleIn } from "#/server/class-access";

export const AnnouncementInput = type({ body: type("string.trim").to("1 <= string <= 10000") });
export type AnnouncementInput = typeof AnnouncementInput.infer;

// Every announcement write starts here: the class lock, then the actor must teach the class.
// Any teacher of the class may edit or delete any announcement in it, not only their own.
async function writeAnnouncements(tx: Tx, actor: UserId, classId: ClassId) {
	if (!(await lockClass(tx, classId))) return NOT_FOUND;
	const role = await roleIn(tx, classId, actor);
	if (!role) return NOT_FOUND;
	if (role !== "teacher") return fail("forbidden");
	return OK;
}

// writeAnnouncements for the class that holds this announcement.
async function writeAnnouncement(tx: Tx, actor: UserId, id: AnnouncementId) {
	const [found] = await tx
		.select({ classId: announcement.classId })
		.from(announcement)
		.where(eq(announcement.id, id));
	return found ? writeAnnouncements(tx, actor, found.classId) : NOT_FOUND;
}

export async function createAnnouncement(
	actor: UserId,
	classId: ClassId,
	input: AnnouncementInput,
) {
	return db.transaction(async (tx) => {
		const access = await writeAnnouncements(tx, actor, classId);
		if (!access.ok) return access;
		const [created] = await tx
			.insert(announcement)
			.values({ classId, authorId: actor, body: input.body })
			.returning({ id: announcement.id });
		if (!created) throw new Error("Inserting an announcement returned no row");
		return { ok: true, announcementId: created.id } as const;
	});
}

export async function editAnnouncement(
	actor: UserId,
	id: AnnouncementId,
	input: AnnouncementInput,
) {
	return db.transaction(async (tx) => {
		const access = await writeAnnouncement(tx, actor, id);
		if (!access.ok) return access;
		// No row when a parallel delete committed while we waited for the lock.
		const [updated] = await tx
			.update(announcement)
			.set({ body: input.body, editedAt: new Date() })
			.where(eq(announcement.id, id))
			.returning({ id: announcement.id });
		return updated ? OK : NOT_FOUND;
	});
}

// A hard delete: announcements have no replies to keep.
export async function deleteAnnouncement(actor: UserId, id: AnnouncementId) {
	return db.transaction(async (tx) => {
		const access = await writeAnnouncement(tx, actor, id);
		if (!access.ok) return access;
		await tx.delete(announcement).where(eq(announcement.id, id));
		return OK;
	});
}

// Newest first. Only the author's display name leaves the server.
export async function listAnnouncements(actor: UserId, classId: ClassId) {
	if (!(await roleIn(db, classId, actor))) return NOT_FOUND;
	const announcements = await db
		.select({
			id: announcement.id,
			authorName: user.name,
			body: announcement.body,
			createdAt: announcement.createdAt,
			editedAt: announcement.editedAt,
		})
		.from(announcement)
		.innerJoin(user, eq(user.id, announcement.authorId))
		.where(eq(announcement.classId, classId))
		.orderBy(desc(announcement.createdAt), desc(announcement.id));
	return { ok: true, announcements } as const;
}
