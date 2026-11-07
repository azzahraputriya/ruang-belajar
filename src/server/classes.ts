// Owns: every class, member, and invite operation, with its membership check and its input rules. Not here: the invite transition table (src/server/invite-lifecycle.ts) or session and cookie wiring (src/server/class-fns.ts).

import { type } from "arktype";
import { and, count, desc, eq, getTableColumns } from "drizzle-orm";
import { user } from "#/db/auth-schema.gen";
import { type ClassRole, classInvite, classMember, classRole, classTable } from "#/db/class-schema";
import { db } from "#/db/client";
import { type ClassId, type InviteId, UserId } from "#/db/ids";
import { Username } from "#/lib/sign-up-rules";
import { type InviteAction, decideInvite } from "#/server/invite-lifecycle";

export const ClassRoleInput = type.enumerated(...classRole.enumValues);

export const CreateClassInput = type({
	title: type("string.trim").to("1 <= string <= 100"),
	subject: type("string.trim").to("1 <= string <= 60"),
});
export type CreateClassInput = typeof CreateClassInput.infer;

export const InviteInput = type({ username: Username, role: ClassRoleInput.default("student") });
export type InviteInput = typeof InviteInput.infer;

type Fail<R extends string> = { ok: false; reason: R };
const fail = <R extends string>(reason: R): Fail<R> => ({ ok: false, reason });
// A missing class and a class you aren't in give this same value, so non-members learn nothing.
const NOT_FOUND = Object.freeze(fail("not_found"));
const OK = { ok: true } as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function roleIn(conn: typeof db | Tx, classId: ClassId, userId: UserId) {
	const [row] = await conn
		.select({ role: classMember.role })
		.from(classMember)
		.where(and(eq(classMember.classId, classId), eq(classMember.userId, userId)));
	return row?.role;
}

// Changes that depend on who teaches take this lock first. They then run one at a time per class,
// and every read after it sees the changes that committed while it waited.
// "no key update", not "update": it still blocks other lockClass calls, but not the foreign-key
// check of an accept inserting a member. "update" deadlocks an accept against a parallel invite().
async function lockClass(tx: Tx, classId: ClassId) {
	const [locked] = await tx
		.select({ id: classTable.id })
		.from(classTable)
		.where(eq(classTable.id, classId))
		.for("no key update");
	return locked !== undefined;
}

// The creator becomes the first teacher in the same transaction, so a class never exists without one.
export async function createClass(actor: UserId, input: CreateClassInput) {
	return db.transaction(async (tx) => {
		const [created] = await tx.insert(classTable).values(input).returning();
		if (!created) throw new Error("Inserting a class returned no row");
		await tx.insert(classMember).values({ classId: created.id, userId: actor, role: "teacher" });
		return { ok: true, class: created } as const;
	});
}

export async function listMyClasses(actor: UserId) {
	return db
		.select({ ...getTableColumns(classTable), myRole: classMember.role })
		.from(classMember)
		.innerJoin(classTable, eq(classTable.id, classMember.classId))
		.where(eq(classMember.userId, actor))
		.orderBy(classTable.title);
}

// The invitee isn't a member yet, but still sees the class title and who invited them.
export async function listMyPendingInvites(actor: UserId) {
	return db
		.select({
			id: classInvite.id,
			classId: classInvite.classId,
			classTitle: classTable.title,
			role: classInvite.role,
			invitedBy: user.username,
			createdAt: classInvite.createdAt,
		})
		.from(classInvite)
		.innerJoin(classTable, eq(classTable.id, classInvite.classId))
		.innerJoin(user, eq(user.id, classInvite.invitedById))
		.where(and(eq(classInvite.inviteeId, actor), eq(classInvite.status, "pending")))
		.orderBy(desc(classInvite.createdAt));
}

export async function getClass(actor: UserId, classId: ClassId) {
	const [row] = await db
		.select({ ...getTableColumns(classTable), myRole: classMember.role })
		.from(classTable)
		.innerJoin(
			classMember,
			and(eq(classMember.classId, classTable.id), eq(classMember.userId, actor)),
		)
		.where(eq(classTable.id, classId));
	return row ? ({ ok: true, class: row } as const) : NOT_FOUND;
}

export async function listMembers(actor: UserId, classId: ClassId) {
	if (!(await roleIn(db, classId, actor))) return NOT_FOUND;
	const members = await db
		.select({
			userId: classMember.userId,
			username: user.username,
			name: user.name,
			role: classMember.role,
			joinedAt: classMember.joinedAt,
		})
		.from(classMember)
		.innerJoin(user, eq(user.id, classMember.userId))
		.where(eq(classMember.classId, classId))
		.orderBy(classMember.joinedAt);
	return { ok: true, members } as const;
}

// Teachers only: who was invited but hasn't answered. The invitee is joined for their username.
export async function listClassInvites(actor: UserId, classId: ClassId) {
	const role = await roleIn(db, classId, actor);
	if (!role) return NOT_FOUND;
	if (role !== "teacher") return fail("forbidden");
	const invites = await db
		.select({
			id: classInvite.id,
			username: user.username,
			role: classInvite.role,
			createdAt: classInvite.createdAt,
		})
		.from(classInvite)
		.innerJoin(user, eq(user.id, classInvite.inviteeId))
		.where(and(eq(classInvite.classId, classId), eq(classInvite.status, "pending")))
		.orderBy(desc(classInvite.createdAt));
	return { ok: true, invites } as const;
}

// Locked like changeMember, so a teacher who is being demoted can't send one last invite.
export async function invite(actor: UserId, classId: ClassId, input: InviteInput) {
	return db.transaction(async (tx) => {
		if (!(await lockClass(tx, classId))) return NOT_FOUND;
		const role = await roleIn(tx, classId, actor);
		if (!role) return NOT_FOUND;
		if (role !== "teacher") return fail("forbidden");
		const [found] = await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.username, input.username));
		if (!found) return fail("user_not_found");
		const inviteeId = UserId.assert(found.id);
		if (await roleIn(tx, classId, inviteeId)) return fail("already_member");
		// The partial unique index allows one pending invite per class and user. A second insert hits it and adds nothing.
		const [created] = await tx
			.insert(classInvite)
			.values({ classId, inviteeId, invitedById: actor, role: input.role })
			.onConflictDoNothing()
			.returning({ id: classInvite.id });
		return created ? ({ ok: true, inviteId: created.id } as const) : fail("already_invited");
	});
}

// Locks the invite row, so an accept and a revoke at the same moment can't both win.
async function moveInvite(actor: UserId, inviteId: InviteId, action: InviteAction) {
	return db.transaction(async (tx) => {
		const [found] = await tx
			.select()
			.from(classInvite)
			.where(eq(classInvite.id, inviteId))
			.for("update");
		if (!found) return NOT_FOUND;
		const relation =
			found.inviteeId === actor ? "invitee" : ((await roleIn(tx, found.classId, actor)) ?? "none");
		const decision = decideInvite(action, found.status, relation);
		if (!decision.ok) return fail(decision.reason);
		const done = { ok: true, classId: found.classId, status: decision.to } as const;
		if (!decision.changed) return done;
		await tx
			.update(classInvite)
			.set({ status: decision.to, respondedAt: new Date() })
			.where(eq(classInvite.id, inviteId));
		if (action === "accept") {
			// The invitee can already be a member: invite() can run while an earlier invite's accept commits.
			// Accepting then just closes the extra invite and keeps the existing role.
			await tx
				.insert(classMember)
				.values({ classId: found.classId, userId: actor, role: found.role })
				.onConflictDoNothing();
		}
		return done;
	});
}

export const acceptInvite = (actor: UserId, inviteId: InviteId) =>
	moveInvite(actor, inviteId, "accept");
export const declineInvite = (actor: UserId, inviteId: InviteId) =>
	moveInvite(actor, inviteId, "decline");
export const revokeInvite = (actor: UserId, inviteId: InviteId) =>
	moveInvite(actor, inviteId, "revoke");

// One path for role changes, removals, and leaving, so the last-teacher rule lives in one place.
// A new role, or "remove" to take the member out of the class.
async function changeMember(
	actor: UserId,
	classId: ClassId,
	targetId: UserId,
	change: ClassRole | "remove",
) {
	// Anyone can leave. Everything else is a teacher's job, including changing your own role.
	const needsTeacher = change !== "remove" || targetId !== actor;
	return db.transaction(async (tx) => {
		// Without the lock, the only two teachers could each demote themselves, both counting two teachers.
		if (!(await lockClass(tx, classId))) return NOT_FOUND;
		const actorRole = await roleIn(tx, classId, actor);
		if (!actorRole) return NOT_FOUND;
		if (needsTeacher && actorRole !== "teacher") return fail("forbidden");
		const targetRole = targetId === actor ? actorRole : await roleIn(tx, classId, targetId);
		if (!targetRole) return fail("member_not_found");
		if (targetRole === "teacher" && change !== "teacher") {
			const [teachers] = await tx
				.select({ n: count() })
				.from(classMember)
				.where(and(eq(classMember.classId, classId), eq(classMember.role, "teacher")));
			if ((teachers?.n ?? 0) <= 1) return fail("last_teacher");
		}
		const target = and(eq(classMember.classId, classId), eq(classMember.userId, targetId));
		if (change === "remove") await tx.delete(classMember).where(target);
		else await tx.update(classMember).set({ role: change }).where(target);
		return OK;
	});
}

export const changeRole = (actor: UserId, classId: ClassId, userId: UserId, role: ClassRole) =>
	changeMember(actor, classId, userId, role);
export const removeMember = (actor: UserId, classId: ClassId, userId: UserId) =>
	changeMember(actor, classId, userId, "remove");
export const leaveClass = (actor: UserId, classId: ClassId) =>
	changeMember(actor, classId, actor, "remove");
