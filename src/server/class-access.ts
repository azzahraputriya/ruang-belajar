// Owns: the membership lookup and class lock that every class-scoped operation starts with, and the shared result values. Not here: the operations themselves (src/server/classes.ts, src/server/modules.ts).

import { and, eq } from "drizzle-orm";
import { classMember, classTable } from "#/db/class-schema";
import type { db } from "#/db/client";
import type { ClassId, UserId } from "#/db/ids";

type Fail<R extends string> = { ok: false; reason: R };
export const fail = <R extends string>(reason: R): Fail<R> => ({ ok: false, reason });
// A missing class and a class you aren't in give this same value, so non-members learn nothing.
export const NOT_FOUND = Object.freeze(fail("not_found"));
export const OK = { ok: true } as const;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Conn = typeof db | Tx;

export async function roleIn(conn: Conn, classId: ClassId, userId: UserId) {
	const [row] = await conn
		.select({ role: classMember.role })
		.from(classMember)
		.where(and(eq(classMember.classId, classId), eq(classMember.userId, userId)));
	return row?.role;
}

// Changes that depend on who teaches, or on the order of a class's modules, take this lock first.
// They then run one at a time per class, and every read after it sees the changes that committed while it waited.
// "no key update", not "update": it still blocks other lockClass calls, but not the foreign-key
// check of an accept inserting a member. "update" deadlocks an accept against a parallel invite().
export async function lockClass(tx: Tx, classId: ClassId) {
	const [locked] = await tx
		.select({ id: classTable.id })
		.from(classTable)
		.where(eq(classTable.id, classId))
		.for("no key update");
	return locked !== undefined;
}
