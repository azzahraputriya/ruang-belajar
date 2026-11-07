// Owns: every submission operation on assignment and reflection steps (a student's draft, submit, and own view, the teacher's list, return, and grade) with its membership check and input rules, plus the grade rules. Not here: the lifecycle table and lateness (src/server/submission-lifecycle.ts), file uploads (src/server/submission-files.ts), or session wiring (src/server/submission-fns.ts).

import { type } from "arktype";
import { and, asc, eq, inArray } from "drizzle-orm";
import { user } from "#/db/auth-schema.gen";
import { classMember } from "#/db/class-schema";
import { moduleTable, step } from "#/db/content-schema";
import { db } from "#/db/client";
import type { StepId, SubmissionId, UserId } from "#/db/ids";
import { submission, submissionEvent, submissionFile } from "#/db/submission-schema";
import { type Conn, NOT_FOUND, type Tx, fail, lockClass } from "#/server/class-access";
import { contentOf, stepFor, writeStep } from "#/server/modules";
import { type SubmissionDecision, decideSubmission, isLate } from "#/server/submission-lifecycle";
import { Markdown, type Rubric, type StepContent } from "#/server/step-kinds";

export const DraftInput = type({ text: Markdown });
export type DraftInput = typeof DraftInput.infer;

const Comment = type("string.trim").to("string <= 5000");

export const ReturnInput = type({ comment: Comment.to("string > 0") });
export type ReturnInput = typeof ReturnInput.infer;

// Points per rubric criterion id, or one overall score when the step has no rubric. Which one is
// checked against the step in gradeFor, because only the step knows if it has a rubric.
const Points = type("Record<string, number.integer>");
export const GradeInput = type({
	"+": "reject",
	"points?": Points,
	"score?": "number.integer",
	"comment?": Comment,
});
export type GradeInput = typeof GradeInput.infer;

type Accepts = { text: boolean; files: boolean };

// What a student may hand in on a step. Null for kinds that take no submission.
export function acceptsOf(parsed: StepContent): Accepts | null {
	if (parsed.kind === "assignment") return parsed.content.accepts;
	if (parsed.kind === "reflection") return { text: true, files: false };
	return null;
}

// The total and per-criterion points a grade gives, checked against the step's rubric. With a
// rubric, every criterion gets 0 to its maxPoints and the score is their sum. Without one, the
// score is 0 to 100.
const invalid = (problem: string) => ({ ...fail("invalid_grade"), problem });
export function gradeFor(rubric: Rubric | undefined, input: GradeInput) {
	if (!rubric) {
		if (input.points !== undefined) return invalid("this step has no rubric, send score");
		if (input.score === undefined || input.score < 0 || input.score > 100) {
			return invalid("score must be a whole number from 0 to 100");
		}
		return { ok: true, score: input.score, rubricScores: null } as const;
	}
	if (input.score !== undefined || input.points === undefined) {
		return invalid("this step has a rubric, send points for every criterion");
	}
	const points = input.points;
	const known = new Set(rubric.map((c) => c.id));
	const stray = Object.keys(points).find((id) => !known.has(id));
	if (stray !== undefined) return invalid(`no criterion ${stray}`);
	let score = 0;
	for (const criterion of rubric) {
		const given = points[criterion.id];
		if (given === undefined) return invalid(`criterion ${criterion.id} has no points`);
		if (given < 0 || given > criterion.maxPoints) {
			return invalid(`criterion ${criterion.id} takes 0 to ${criterion.maxPoints} points`);
		}
		score += given;
	}
	return { ok: true, score, rubricScores: points } as const;
}

const samePoints = (a: Record<string, number> | null, b: Record<string, number> | null) =>
	a === null || b === null
		? a === b
		: Object.keys(a).length === Object.keys(b).length &&
			Object.entries(a).every(([id, value]) => b[id] === value);

type Row = typeof submission.$inferSelect;

const refuse = (decision: Extract<SubmissionDecision, { ok: false }>, row: Row) => ({
	...fail(decision.reason),
	status: row.status,
});

// Submissions as students and teachers see them, with files, history, and lateness.
// Every read goes through here, so the rubric scores jsonb is never trusted.
async function viewsOf(conn: Conn, rows: readonly Row[], dueAt: Date | null) {
	const ids = rows.map((r) => r.id);
	const [files, events] =
		ids.length === 0
			? [[], []]
			: await Promise.all([
					conn
						.select({
							id: submissionFile.id,
							submissionId: submissionFile.submissionId,
							filename: submissionFile.filename,
							mimeType: submissionFile.mimeType,
							size: submissionFile.size,
							uploadedAt: submissionFile.uploadedAt,
						})
						.from(submissionFile)
						.where(inArray(submissionFile.submissionId, ids))
						.orderBy(asc(submissionFile.uploadedAt)),
					conn
						.select({
							submissionId: submissionEvent.submissionId,
							action: submissionEvent.action,
							comment: submissionEvent.comment,
							score: submissionEvent.score,
							at: submissionEvent.at,
						})
						.from(submissionEvent)
						.where(inArray(submissionEvent.submissionId, ids))
						.orderBy(asc(submissionEvent.at)),
				]);
	return rows.map((row) => ({
		id: row.id,
		stepId: row.stepId,
		studentId: row.studentId,
		status: row.status,
		text: row.text,
		submittedAt: row.submittedAt,
		late: isLate(row.submittedAt, dueAt),
		returnedAt: row.returnedAt,
		gradedAt: row.gradedAt,
		comment: row.comment,
		score: row.score,
		rubricScores: row.rubricScores === null ? null : Points.assert(row.rubricScores),
		updatedAt: row.updatedAt,
		files: files.filter((f) => f.submissionId === row.id),
		events: events.filter((e) => e.submissionId === row.id),
	}));
}
export type SubmissionView = Awaited<ReturnType<typeof viewsOf>>[number];

async function viewOf(conn: Conn, row: Row, dueAt: Date | null) {
	const [view] = await viewsOf(conn, [row], dueAt);
	if (!view) throw new Error("viewsOf dropped a row");
	return view;
}

// Every student write on a step starts here: the class lock, then the actor must be a student who
// can see the step, and the step must take submissions. Comes back with their submission, if any.
// The lock keeps a save, submit, return, and grade on one class from interleaving.
export async function writeOwn(tx: Tx, actor: UserId, stepId: StepId) {
	const [found] = await tx
		.select({ classId: moduleTable.classId })
		.from(step)
		.innerJoin(moduleTable, eq(moduleTable.id, step.moduleId))
		.where(eq(step.id, stepId));
	if (!found || !(await lockClass(tx, found.classId))) return NOT_FOUND;
	// Read again under the lock: membership, the step, or the module may have changed while we waited.
	return ownSubmission(tx, actor, stepId);
}

// The acting student's submission on a step they can see that takes submissions, if they have one.
// Teachers get "forbidden", and people who shouldn't learn the step exists get "not_found".
export async function ownSubmission(conn: Conn, actor: UserId, stepId: StepId) {
	const access = await stepFor(conn, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.role !== "student") return fail("forbidden");
	const accepts = acceptsOf(contentOf(access.step));
	if (!accepts) return fail("not_a_submission_step");
	const [row] = await conn
		.select()
		.from(submission)
		.where(and(eq(submission.stepId, stepId), eq(submission.studentId, actor)));
	return { ok: true, accepts, dueAt: access.dueAt, row } as const;
}

// Every teacher move on a submission starts here: writeStep (class lock, then teacher check),
// then the submission and its step as they are under the lock.
async function writeAsTeacher(tx: Tx, actor: UserId, submissionId: SubmissionId) {
	const [found] = await tx
		.select({ stepId: submission.stepId })
		.from(submission)
		.where(eq(submission.id, submissionId));
	if (!found) return NOT_FOUND;
	const access = await writeStep(tx, actor, found.stepId);
	if (!access.ok) return access;
	const [row] = await tx.select().from(submission).where(eq(submission.id, submissionId));
	const [stepRow] = await tx.select().from(step).where(eq(step.id, found.stepId));
	if (!row || !stepRow) return NOT_FOUND;
	return { ok: true, row, parsed: contentOf(stepRow), dueAt: access.dueAt } as const;
}

// The acting student's own submission on a step, or null before they start one.
export async function getMySubmission(actor: UserId, stepId: StepId) {
	const access = await ownSubmission(db, actor, stepId);
	if (!access.ok) return access;
	const { accepts, dueAt, row } = access;
	return {
		ok: true,
		accepts,
		dueAt,
		submission: row ? await viewOf(db, row, dueAt) : null,
	} as const;
}

// Saves the student's text. Starts the draft when there is none. Only while the work is theirs to
// change: a draft, or work a teacher returned.
export async function saveDraft(actor: UserId, stepId: StepId, input: DraftInput) {
	return db.transaction(async (tx) => {
		const access = await writeOwn(tx, actor, stepId);
		if (!access.ok) return access;
		if (access.row) {
			const decision = decideSubmission("save", access.row.status, "student");
			if (!decision.ok) return refuse(decision, access.row);
		}
		if (!access.accepts.text && input.text !== "") return fail("text_not_accepted");
		const now = new Date();
		const [saved] = await tx
			.insert(submission)
			.values({ stepId, studentId: actor, text: input.text, updatedAt: now })
			.onConflictDoUpdate({
				target: [submission.stepId, submission.studentId],
				set: { text: input.text, updatedAt: now },
			})
			.returning();
		if (!saved) throw new Error("Saving a draft returned no row");
		return { ok: true, submission: await viewOf(tx, saved, access.dueAt) } as const;
	});
}

// Hands the work in. It needs something the step accepts: text, or at least one file.
// `submittedAt` keeps the first submit, so a resubmit after a return is judged on time when the first
// one was. A teacher asking for changes after the due date doesn't make the student late.
export async function submit(actor: UserId, stepId: StepId) {
	return db.transaction(async (tx) => {
		const access = await writeOwn(tx, actor, stepId);
		if (!access.ok) return access;
		const { row, accepts } = access;
		if (!row) return fail("empty");
		const decision = decideSubmission("submit", row.status, "student");
		if (!decision.ok) return refuse(decision, row);
		if (decision.repeat) {
			return { ok: true, changed: false, submission: await viewOf(tx, row, access.dueAt) } as const;
		}
		const files = await tx
			.select({ id: submissionFile.id })
			.from(submissionFile)
			.where(eq(submissionFile.submissionId, row.id));
		const hasText = accepts.text && row.text.trim() !== "";
		const hasFiles = accepts.files && files.length > 0;
		if (!hasText && !hasFiles) return fail("empty");
		// Set here, not by Postgres: it keeps microseconds and JS keeps milliseconds, which would
		// turn a submit exactly on the due date into a late one.
		const now = new Date();
		const [updated] = await tx
			.update(submission)
			.set({ status: decision.to, submittedAt: row.submittedAt ?? now, updatedAt: now })
			.where(eq(submission.id, row.id))
			.returning();
		if (!updated) throw new Error("Updating a locked submission returned no row");
		await tx.insert(submissionEvent).values({ submissionId: row.id, action: "submit", at: now });
		return {
			ok: true,
			changed: true,
			submission: await viewOf(tx, updated, access.dueAt),
		} as const;
	});
}

// Sends the work back to the student for changes, with a comment saying what to change.
export async function returnSubmission(
	actor: UserId,
	submissionId: SubmissionId,
	input: ReturnInput,
) {
	return db.transaction(async (tx) => {
		const access = await writeAsTeacher(tx, actor, submissionId);
		if (!access.ok) return access;
		const { row } = access;
		const decision = decideSubmission("return", row.status, "teacher");
		if (!decision.ok) return refuse(decision, row);
		if (decision.repeat) {
			if (row.comment !== input.comment) return { ...fail("wrong_status"), status: row.status };
			return { ok: true, changed: false, submission: await viewOf(tx, row, access.dueAt) } as const;
		}
		const now = new Date();
		const [updated] = await tx
			.update(submission)
			.set({ status: decision.to, returnedAt: now, comment: input.comment, updatedAt: now })
			.where(eq(submission.id, row.id))
			.returning();
		if (!updated) throw new Error("Updating a locked submission returned no row");
		await tx
			.insert(submissionEvent)
			.values({ submissionId: row.id, action: "return", comment: input.comment, at: now });
		return {
			ok: true,
			changed: true,
			submission: await viewOf(tx, updated, access.dueAt),
		} as const;
	});
}

// Grades handed-in work. Graded is final: the same grade again changes nothing, and a different one
// is refused. A reflection is never scored. The row's comment becomes the grade's comment, or null;
// the return comments before it stay in the history.
export async function grade(actor: UserId, submissionId: SubmissionId, input: GradeInput) {
	return db.transaction(async (tx) => {
		const access = await writeAsTeacher(tx, actor, submissionId);
		if (!access.ok) return access;
		const { row, parsed } = access;
		if (parsed.kind !== "assignment") return fail("not_scored");
		const graded = gradeFor(parsed.content.rubric, input);
		if (!graded.ok) return graded;
		const comment = input.comment || null;
		const decision = decideSubmission("grade", row.status, "teacher");
		if (!decision.ok) return refuse(decision, row);
		if (decision.repeat) {
			const stored = row.rubricScores === null ? null : Points.assert(row.rubricScores);
			const same =
				row.score === graded.score &&
				row.comment === comment &&
				samePoints(stored, graded.rubricScores);
			if (!same) return { ...fail("wrong_status"), status: row.status };
			return { ok: true, changed: false, submission: await viewOf(tx, row, access.dueAt) } as const;
		}
		const now = new Date();
		const [updated] = await tx
			.update(submission)
			.set({
				status: decision.to,
				gradedAt: now,
				score: graded.score,
				rubricScores: graded.rubricScores,
				comment,
				updatedAt: now,
			})
			.where(eq(submission.id, row.id))
			.returning();
		if (!updated) throw new Error("Updating a locked submission returned no row");
		await tx
			.insert(submissionEvent)
			.values({ submissionId: row.id, action: "grade", comment, score: graded.score, at: now });
		return {
			ok: true,
			changed: true,
			submission: await viewOf(tx, updated, access.dueAt),
		} as const;
	});
}

// Every current student of the class with their submission on the step, or null before they start.
// Drafts are included: a teacher sees work in progress. Someone who left the class drops out.
export async function listSubmissions(actor: UserId, stepId: StepId) {
	const access = await stepFor(db, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.role !== "teacher") return fail("forbidden");
	if (!acceptsOf(contentOf(access.step))) return fail("not_a_submission_step");
	const rows = await db
		.select({ userId: classMember.userId, username: user.username, name: user.name, submission })
		.from(classMember)
		.innerJoin(user, eq(user.id, classMember.userId))
		.leftJoin(
			submission,
			and(eq(submission.studentId, classMember.userId), eq(submission.stepId, stepId)),
		)
		.where(and(eq(classMember.classId, access.classId), eq(classMember.role, "student")))
		.orderBy(asc(user.username));
	const views = await viewsOf(
		db,
		rows.flatMap((r) => (r.submission ? [r.submission] : [])),
		access.dueAt,
	);
	const viewById = new Map(views.map((v) => [v.id, v]));
	return {
		ok: true,
		dueAt: access.dueAt,
		students: rows.map((r) => ({
			userId: r.userId,
			username: r.username,
			name: r.name,
			submission: r.submission ? (viewById.get(r.submission.id) ?? null) : null,
		})),
	} as const;
}
