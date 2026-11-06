// Owns: every module, step, and step visit operation with its membership check and input rules, plus the progress queries. Not here: each kind's content shape and status rule (src/server/step-kinds.ts) or session wiring (src/server/module-fns.ts).

import { type } from "arktype";
import { type Column, and, asc, eq, gt, sql } from "drizzle-orm";
import { user } from "#/db/auth-schema.gen";
import { type ClassRole, classMember } from "#/db/class-schema";
import {
	type VisitEvent,
	moduleTable,
	step,
	stepKind,
	stepVisit,
	visitEvent,
} from "#/db/content-schema";
import { db } from "#/db/client";
import type { ClassId, ModuleId, StepId, UserId } from "#/db/ids";
import { type Conn, NOT_FOUND, OK, type Tx, fail, lockClass, roleIn } from "#/server/class-access";
import { STEP_KINDS, parseStepContent, stepStatus } from "#/server/step-kinds";

const Title = type("string.trim").to("1 <= string <= 200");

// Create and update both send every field, so leaving a date out clears it.
export const ModuleInput = type({
	title: Title,
	opensAt: type("Date | null").default(null),
	dueAt: type("Date | null").default(null),
}).narrow(
	({ opensAt, dueAt }, ctx) =>
		!opensAt ||
		!dueAt ||
		dueAt >= opensAt ||
		ctx.reject({ path: ["dueAt"], expected: "on or after opensAt" }),
);
export type ModuleInput = typeof ModuleInput.infer;

export const StepKindInput = type.enumerated(...stepKind.enumValues);

// `content` is checked against the shape its `kind` names in the registry.
export const StepInput = type({ kind: StepKindInput, title: Title, content: "unknown" }).pipe(
	({ title, kind, content }, ctx) => {
		const parsed = parseStepContent(kind, content);
		if (parsed instanceof type.errors) return ctx.error(`content for ${kind}: ${parsed.summary}`);
		return { title, ...parsed };
	},
);
export type StepInput = typeof StepInput.infer;

export const VisitEventInput = type.enumerated(...visitEvent.enumValues);

// Students only see a module once it opens. Teachers see every module.
const visibleTo = (role: ClassRole, opensAt: Date | null, now = new Date()) =>
	role === "teacher" || opensAt === null || opensAt <= now;

// The module and the actor's role in its class. Undefined when the actor shouldn't learn the module
// exists: not a member, or a student before it opens.
async function moduleFor(conn: Conn, actor: UserId, moduleId: ModuleId) {
	const [found] = await conn
		.select({
			classId: moduleTable.classId,
			opensAt: moduleTable.opensAt,
			position: moduleTable.position,
		})
		.from(moduleTable)
		.where(eq(moduleTable.id, moduleId));
	if (!found) return undefined;
	const role = await roleIn(conn, found.classId, actor);
	if (!role || !visibleTo(role, found.opensAt)) return undefined;
	return { ...found, role };
}

// Every write to a module or its steps starts here. It takes the class lock, then checks the actor
// teaches the class. One lock per class keeps positions changing one writer at a time, and a teacher
// being demoted at the same moment can't get one last edit in.
async function writeModule(tx: Tx, actor: UserId, moduleId: ModuleId) {
	const [found] = await tx
		.select({ classId: moduleTable.classId })
		.from(moduleTable)
		.where(eq(moduleTable.id, moduleId));
	if (!found || !(await lockClass(tx, found.classId))) return NOT_FOUND;
	// Read again under the lock: the module may have moved or gone while we waited.
	const access = await moduleFor(tx, actor, moduleId);
	if (!access) return NOT_FOUND;
	if (access.role !== "teacher") return fail("forbidden");
	return { ok: true, ...access } as const;
}

// writeModule for the module that holds this step.
async function writeStep(tx: Tx, actor: UserId, stepId: StepId) {
	const [found] = await tx
		.select({ moduleId: step.moduleId })
		.from(step)
		.where(eq(step.id, stepId));
	if (!found) return NOT_FOUND;
	const access = await writeModule(tx, actor, found.moduleId);
	if (!access.ok) return access;
	// Read again under the lock: a parallel delete may have removed it while we waited.
	const [locked] = await tx
		.select({ kind: step.kind, stepPosition: step.position })
		.from(step)
		.where(eq(step.id, stepId));
	return locked ? { ...access, ...locked, moduleId: found.moduleId } : NOT_FOUND;
}

// Same as moduleFor, for the step's module, along with the step row.
async function stepFor(conn: Conn, actor: UserId, stepId: StepId) {
	const [found] = await conn.select().from(step).where(eq(step.id, stepId));
	if (!found) return undefined;
	const access = await moduleFor(conn, actor, found.moduleId);
	return access && { ...access, step: found };
}

// Every read of a step goes through here, so the app never trusts raw jsonb.
function toStep(row: typeof step.$inferSelect) {
	const parsed = parseStepContent(row.kind, row.content);
	if (parsed instanceof type.errors) {
		throw new Error(`Step ${row.id} has invalid ${row.kind} content: ${parsed.summary}`);
	}
	return {
		id: row.id,
		moduleId: row.moduleId,
		position: row.position,
		title: row.title,
		createdAt: row.createdAt,
		...parsed,
	};
}
export type Step = ReturnType<typeof toStep>;

// The ordered list must be exactly the current ids, each once. Postgres returns uuids in lowercase,
// and an uppercase uuid is still valid input, so both sides are lowercased before comparing.
function sameIds(current: readonly string[], ordered: readonly string[]) {
	const have = new Set(current.map((id) => id.toLowerCase()));
	const want = ordered.map((id) => id.toLowerCase());
	return (
		want.length === have.size &&
		new Set(want).size === want.length &&
		want.every((id) => have.has(id))
	);
}

// Each id's new position, as one CASE, so a reorder is a single UPDATE. Needs at least one id.
const positionsIn = (idColumn: Column, orderedIds: readonly string[]) =>
	sql`case ${idColumn} ${sql.join(
		orderedIds.map((id, position) => sql`when ${id}::uuid then ${position}::int`),
		sql` `,
	)} end`;

export async function createModule(actor: UserId, classId: ClassId, input: ModuleInput) {
	return db.transaction(async (tx) => {
		// Locked so two creates in a row can't both take the same last position.
		if (!(await lockClass(tx, classId))) return NOT_FOUND;
		const role = await roleIn(tx, classId, actor);
		if (!role) return NOT_FOUND;
		if (role !== "teacher") return fail("forbidden");
		const [created] = await tx
			.insert(moduleTable)
			.values({
				...input,
				classId,
				position: sql`(select count(*) from ${moduleTable} where ${moduleTable.classId} = ${classId})`,
			})
			.returning();
		if (!created) throw new Error("Inserting a module returned no row");
		return { ok: true, module: created } as const;
	});
}

export async function updateModule(actor: UserId, moduleId: ModuleId, input: ModuleInput) {
	return db.transaction(async (tx) => {
		const access = await writeModule(tx, actor, moduleId);
		if (!access.ok) return access;
		const [updated] = await tx
			.update(moduleTable)
			.set(input)
			.where(eq(moduleTable.id, moduleId))
			.returning();
		if (!updated) throw new Error("Updating a locked module returned no row");
		return { ok: true, module: updated } as const;
	});
}

export async function deleteModule(actor: UserId, moduleId: ModuleId) {
	return db.transaction(async (tx) => {
		const access = await writeModule(tx, actor, moduleId);
		if (!access.ok) return access;
		await tx.delete(moduleTable).where(eq(moduleTable.id, moduleId));
		await tx
			.update(moduleTable)
			.set({ position: sql`${moduleTable.position} - 1` })
			.where(
				and(eq(moduleTable.classId, access.classId), gt(moduleTable.position, access.position)),
			);
		return OK;
	});
}

export async function reorderModules(actor: UserId, classId: ClassId, orderedIds: ModuleId[]) {
	return db.transaction(async (tx) => {
		if (!(await lockClass(tx, classId))) return NOT_FOUND;
		const role = await roleIn(tx, classId, actor);
		if (!role) return NOT_FOUND;
		if (role !== "teacher") return fail("forbidden");
		const current = await tx
			.select({ id: moduleTable.id })
			.from(moduleTable)
			.where(eq(moduleTable.classId, classId));
		if (
			!sameIds(
				current.map((m) => m.id),
				orderedIds,
			)
		)
			return fail("ids_mismatch");
		if (orderedIds.length === 0) return OK;
		await tx
			.update(moduleTable)
			.set({ position: positionsIn(moduleTable.id, orderedIds) })
			.where(eq(moduleTable.classId, classId));
		return OK;
	});
}

export async function createStep(actor: UserId, moduleId: ModuleId, input: StepInput) {
	return db.transaction(async (tx) => {
		const access = await writeModule(tx, actor, moduleId);
		if (!access.ok) return access;
		const [created] = await tx
			.insert(step)
			.values({
				...input,
				moduleId,
				position: sql`(select count(*) from ${step} where ${step.moduleId} = ${moduleId})`,
			})
			.returning();
		if (!created) throw new Error("Inserting a step returned no row");
		return { ok: true, step: toStep(created) } as const;
	});
}

// A step keeps its kind. Students' visits and, later, their attempts belong to that kind.
export async function updateStep(actor: UserId, stepId: StepId, input: StepInput) {
	return db.transaction(async (tx) => {
		const access = await writeStep(tx, actor, stepId);
		if (!access.ok) return access;
		if (access.kind !== input.kind) return fail("kind_changed");
		const [updated] = await tx
			.update(step)
			.set({ title: input.title, content: input.content })
			.where(eq(step.id, stepId))
			.returning();
		if (!updated) throw new Error("Updating a locked step returned no row");
		return { ok: true, step: toStep(updated) } as const;
	});
}

export async function deleteStep(actor: UserId, stepId: StepId) {
	return db.transaction(async (tx) => {
		const access = await writeStep(tx, actor, stepId);
		if (!access.ok) return access;
		await tx.delete(step).where(eq(step.id, stepId));
		await tx
			.update(step)
			.set({ position: sql`${step.position} - 1` })
			.where(and(eq(step.moduleId, access.moduleId), gt(step.position, access.stepPosition)));
		return OK;
	});
}

export async function reorderSteps(actor: UserId, moduleId: ModuleId, orderedIds: StepId[]) {
	return db.transaction(async (tx) => {
		const access = await writeModule(tx, actor, moduleId);
		if (!access.ok) return access;
		const current = await tx.select({ id: step.id }).from(step).where(eq(step.moduleId, moduleId));
		if (
			!sameIds(
				current.map((s) => s.id),
				orderedIds,
			)
		)
			return fail("ids_mismatch");
		if (orderedIds.length === 0) return OK;
		await tx
			.update(step)
			.set({ position: positionsIn(step.id, orderedIds) })
			.where(eq(step.moduleId, moduleId));
		return OK;
	});
}

// Every step in the class, in reading order, with its module's opening time.
async function stepsInClass(classId: ClassId) {
	return db
		.select({
			id: step.id,
			moduleId: step.moduleId,
			kind: step.kind,
			title: step.title,
			position: step.position,
			opensAt: moduleTable.opensAt,
		})
		.from(step)
		.innerJoin(moduleTable, eq(moduleTable.id, step.moduleId))
		.where(eq(moduleTable.classId, classId))
		.orderBy(asc(moduleTable.position), asc(step.position));
}

// Modules in order, each with its steps in order. Content stays out: getStep returns it.
export async function listModules(actor: UserId, classId: ClassId) {
	const role = await roleIn(db, classId, actor);
	if (!role) return NOT_FOUND;
	const now = new Date();
	const [modules, steps] = await Promise.all([
		db
			.select()
			.from(moduleTable)
			.where(eq(moduleTable.classId, classId))
			.orderBy(asc(moduleTable.position)),
		stepsInClass(classId),
	]);
	const visible = modules
		.filter((m) => visibleTo(role, m.opensAt, now))
		.map((m) =>
			Object.assign(m, {
				steps: steps
					.filter((s) => s.moduleId === m.id)
					.map(({ id, kind, title, position }) => ({ id, kind, title, position })),
			}),
		);
	return { ok: true, modules: visible } as const;
}

export async function getStep(actor: UserId, stepId: StepId) {
	const access = await stepFor(db, actor, stepId);
	return access ? ({ ok: true, step: toStep(access.step) } as const) : NOT_FOUND;
}

// Only students have progress, so a teacher previewing a step gets "forbidden" and records nothing.
// Visits are events: repeats are stored, and status reads them as a set, so a repeat changes nothing.
export async function recordVisit(actor: UserId, stepId: StepId, event: VisitEvent) {
	const access = await stepFor(db, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.role !== "student") return fail("forbidden");
	if (event === "finished" && !STEP_KINDS[access.step.kind].finishedByStudent) {
		return fail("not_finishable");
	}
	await db.insert(stepVisit).values({ stepId, studentId: actor, event });
	return OK;
}

// Which events each student has on each step of the class, keyed by `${stepId}/${studentId}`.
async function visitsInClass(classId: ClassId, studentId?: UserId) {
	const rows = await db
		.selectDistinct({
			stepId: stepVisit.stepId,
			studentId: stepVisit.studentId,
			event: stepVisit.event,
		})
		.from(stepVisit)
		.innerJoin(step, eq(step.id, stepVisit.stepId))
		.innerJoin(moduleTable, eq(moduleTable.id, step.moduleId))
		.where(
			and(
				eq(moduleTable.classId, classId),
				studentId ? eq(stepVisit.studentId, studentId) : undefined,
			),
		);
	const visits = new Map<string, Set<VisitEvent>>();
	for (const row of rows) {
		const key = `${row.stepId}/${row.studentId}`;
		visits.set(key, (visits.get(key) ?? new Set()).add(row.event));
	}
	const none: ReadonlySet<VisitEvent> = new Set();
	return (stepId: StepId, student: UserId) => visits.get(`${stepId}/${student}`) ?? none;
}

// The acting student's status on every step they can see, in reading order.
export async function progressFor(actor: UserId, classId: ClassId) {
	const role = await roleIn(db, classId, actor);
	if (!role) return NOT_FOUND;
	if (role !== "student") return fail("forbidden");
	const now = new Date();
	const [steps, visitsOf] = await Promise.all([
		stepsInClass(classId),
		visitsInClass(classId, actor),
	]);
	const progress = steps
		.filter((s) => visibleTo(role, s.opensAt, now))
		.map((s) => ({ stepId: s.id, status: stepStatus(s.kind, { visits: visitsOf(s.id, actor) }) }));
	return { ok: true, progress } as const;
}

// Every current student's status on every step, hidden modules included. Students with no visits
// still appear, all "not_started".
export async function classProgress(actor: UserId, classId: ClassId) {
	const role = await roleIn(db, classId, actor);
	if (!role) return NOT_FOUND;
	if (role !== "teacher") return fail("forbidden");
	const [students, steps, visitsOf] = await Promise.all([
		db
			.select({ userId: classMember.userId, username: user.username, name: user.name })
			.from(classMember)
			.innerJoin(user, eq(user.id, classMember.userId))
			.where(and(eq(classMember.classId, classId), eq(classMember.role, "student")))
			.orderBy(asc(classMember.joinedAt)),
		stepsInClass(classId),
		visitsInClass(classId),
	]);
	return {
		ok: true,
		steps: steps.map(({ id, moduleId, kind, title }) => ({ id, moduleId, kind, title })),
		students: students.map((s) =>
			Object.assign(s, {
				progress: steps.map((st) => ({
					stepId: st.id,
					status: stepStatus(st.kind, { visits: visitsOf(st.id, s.userId) }),
				})),
			}),
		),
	} as const;
}
