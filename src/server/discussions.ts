// Owns: every discussion post operation (list threads, post, reply, edit, delete) with its membership check and input rules. Not here: the post table (src/db/discussion-schema.ts), which posts count toward a step's status (src/server/modules.ts), or session wiring (src/server/discussion-fns.ts).

import { type } from "arktype";
import { asc, eq } from "drizzle-orm";
import { user } from "#/db/auth-schema.gen";
import { moduleTable, step } from "#/db/content-schema";
import { db } from "#/db/client";
import { discussionPost } from "#/db/discussion-schema";
import type { PostId, StepId, UserId } from "#/db/ids";
import { type Conn, NOT_FOUND, OK, type Tx, fail, lockClass } from "#/server/class-access";
import { stepFor } from "#/server/modules";

export const PostInput = type({ body: type("string.trim").to("1 <= string <= 10000") });
export type PostInput = typeof PostInput.infer;

// Anyone in the class who can see the step may read and post, teachers included. Only students'
// posts count toward status, because only students have progress.
async function discussionFor(conn: Conn, actor: UserId, stepId: StepId) {
	const access = await stepFor(conn, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.step.kind !== "discussion") return fail("not_a_discussion");
	return { ok: true, role: access.role } as const;
}

// Every post write starts here: the class lock, then discussionFor under it. The lock keeps a
// removal from the class, or a teacher's delete, from interleaving with a write.
async function writeDiscussion(tx: Tx, actor: UserId, stepId: StepId) {
	const [found] = await tx
		.select({ classId: moduleTable.classId })
		.from(step)
		.innerJoin(moduleTable, eq(moduleTable.id, step.moduleId))
		.where(eq(step.id, stepId));
	if (!found || !(await lockClass(tx, found.classId))) return NOT_FOUND;
	return discussionFor(tx, actor, stepId);
}

// writeDiscussion for the step that holds this post, along with the post as it is under the lock.
async function writePost(tx: Tx, actor: UserId, postId: PostId) {
	const [found] = await tx
		.select({ stepId: discussionPost.stepId })
		.from(discussionPost)
		.where(eq(discussionPost.id, postId));
	if (!found) return NOT_FOUND;
	const access = await writeDiscussion(tx, actor, found.stepId);
	if (!access.ok) return access;
	const [post] = await tx.select().from(discussionPost).where(eq(discussionPost.id, postId));
	return post ? ({ ...access, post } as const) : NOT_FOUND;
}

async function insertPost(tx: Tx, values: typeof discussionPost.$inferInsert) {
	const [created] = await tx.insert(discussionPost).values(values).returning();
	if (!created) throw new Error("Inserting a post returned no row");
	return { ok: true, postId: created.id } as const;
}

// Starts a thread.
export async function createPost(actor: UserId, stepId: StepId, input: PostInput) {
	return db.transaction(async (tx) => {
		const access = await writeDiscussion(tx, actor, stepId);
		if (!access.ok) return access;
		return insertPost(tx, { stepId, authorId: actor, body: input.body });
	});
}

// Replies to a thread. The reply takes its parent's step, so it can't land on another step.
// Threads are one level deep, and a deleted thread takes no new replies.
export async function reply(actor: UserId, parentId: PostId, input: PostInput) {
	return db.transaction(async (tx) => {
		const access = await writePost(tx, actor, parentId);
		if (!access.ok) return access;
		const { post } = access;
		if (post.parentId !== null) return fail("reply_to_reply");
		if (post.deletedAt !== null) return fail("deleted");
		return insertPost(tx, { stepId: post.stepId, authorId: actor, parentId, body: input.body });
	});
}

// Only the author edits, and never after a delete.
export async function editPost(actor: UserId, postId: PostId, input: PostInput) {
	return db.transaction(async (tx) => {
		const access = await writePost(tx, actor, postId);
		if (!access.ok) return access;
		if (access.post.authorId !== actor) return fail("forbidden");
		if (access.post.deletedAt !== null) return fail("deleted");
		await tx
			.update(discussionPost)
			.set({ body: input.body, editedAt: new Date() })
			.where(eq(discussionPost.id, postId));
		return OK;
	});
}

// The author or a class teacher deletes. Deleting twice succeeds and changes nothing.
// The body stays in the row but no read returns it, and the post stops counting toward status.
export async function deletePost(actor: UserId, postId: PostId) {
	return db.transaction(async (tx) => {
		const access = await writePost(tx, actor, postId);
		if (!access.ok) return access;
		if (access.post.authorId !== actor && access.role !== "teacher") return fail("forbidden");
		if (access.post.deletedAt !== null) return OK;
		await tx
			.update(discussionPost)
			.set({ deletedAt: new Date() })
			.where(eq(discussionPost.id, postId));
		return OK;
	});
}

type PostRow = Pick<
	typeof discussionPost.$inferSelect,
	"id" | "authorId" | "body" | "createdAt" | "editedAt" | "deletedAt"
> & { authorName: string };

// A deleted post keeps its place in the thread but shows nothing of what or who it was.
// Only the display name leaves the server, never the username or anything else about the author.
function viewOf(row: PostRow, actor: UserId) {
	const base = { id: row.id, createdAt: row.createdAt };
	if (row.deletedAt !== null) return { ...base, deleted: true } as const;
	return {
		...base,
		deleted: false,
		mine: row.authorId === actor,
		authorName: row.authorName,
		body: row.body,
		editedAt: row.editedAt,
	} as const;
}
export type PostView = ReturnType<typeof viewOf>;

// Threads oldest first, each with its replies oldest first.
export async function listPosts(actor: UserId, stepId: StepId) {
	const access = await discussionFor(db, actor, stepId);
	if (!access.ok) return access;
	const rows = await db
		.select({
			id: discussionPost.id,
			parentId: discussionPost.parentId,
			authorId: discussionPost.authorId,
			authorName: user.name,
			body: discussionPost.body,
			createdAt: discussionPost.createdAt,
			editedAt: discussionPost.editedAt,
			deletedAt: discussionPost.deletedAt,
		})
		.from(discussionPost)
		.innerJoin(user, eq(user.id, discussionPost.authorId))
		.where(eq(discussionPost.stepId, stepId))
		.orderBy(asc(discussionPost.createdAt), asc(discussionPost.id));
	const repliesTo = new Map<PostId, PostView[]>();
	for (const row of rows) {
		if (row.parentId === null) continue;
		const list = repliesTo.get(row.parentId) ?? [];
		list.push(viewOf(row, actor));
		repliesTo.set(row.parentId, list);
	}
	const threads = rows
		.filter((row) => row.parentId === null)
		.map((row) => Object.assign(viewOf(row, actor), { replies: repliesTo.get(row.id) ?? [] }));
	return { ok: true, threads } as const;
}
