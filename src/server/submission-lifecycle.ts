// Owns: the submission lifecycle table, the pure decision of whether a move is allowed, and the lateness rule. Not here: reading or writing submissions (src/server/submissions.ts).

import type { ClassRole } from "#/db/class-schema";
import type { SubmissionStatus } from "#/db/submission-schema";

// "save" edits the work in place: a student's text or files while it's theirs to change.
export type SubmissionMove = "save" | "submit" | "return" | "grade";

// The table in docs/data-model.md, row for row, plus the two "save" rows. Nothing else moves.
export const SUBMISSION_TRANSITIONS = [
	{ from: "draft", action: "save", to: "draft", by: "student" },
	{ from: "returned", action: "save", to: "returned", by: "student" },
	{ from: "draft", action: "submit", to: "submitted", by: "student" },
	{ from: "submitted", action: "return", to: "returned", by: "teacher" },
	{ from: "returned", action: "submit", to: "submitted", by: "student" },
	{ from: "submitted", action: "grade", to: "graded", by: "teacher" },
] as const satisfies readonly {
	from: SubmissionStatus;
	action: SubmissionMove;
	to: SubmissionStatus;
	by: ClassRole;
}[];

export type SubmissionDecision =
	| { ok: true; to: SubmissionStatus; repeat: boolean }
	| { ok: false; reason: "forbidden" | "wrong_status" };

// A move that already happened (submit, return, or grade on a submission that is already there)
// comes back with `repeat: true`, so a double click or retry is harmless. The caller decides
// whether the repeat matches what is stored: a return or grade with a different comment or score
// is a new move, and the table has no row for it.
export function decideSubmission(
	action: SubmissionMove,
	status: SubmissionStatus,
	role: ClassRole,
): SubmissionDecision {
	const rows = SUBMISSION_TRANSITIONS.filter((row) => row.action === action);
	if (!rows.some((row) => row.by === role)) return { ok: false, reason: "forbidden" };
	const row = rows.find((r) => r.from === status);
	if (row) return { ok: true, to: row.to, repeat: false };
	if (action !== "save" && rows.some((r) => r.to === status)) {
		return { ok: true, to: status, repeat: true };
	}
	return { ok: false, reason: "wrong_status" };
}

// Late when first handed in after the module's due date. Exactly on the due date is on time, and a
// module without one is never late.
export const isLate = (submittedAt: Date | null, dueAt: Date | null) =>
	submittedAt !== null && dueAt !== null && submittedAt.getTime() > dueAt.getTime();
