// Owns: tests for the submission lifecycle, grading, lateness, and submission status against the test database. Not here: file uploads (src/server/submission-files.test.ts) or test setup (src/test/).

import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubmissionStatus } from "#/db/submission-schema";
import { type ClassId, type StepId, SubmissionId, type UserId } from "#/db/ids";
import type { ClassRole } from "#/db/class-schema";
import {
	ModuleInput,
	StepInput,
	classProgress,
	createModule,
	createStep,
	progressFor,
	recordVisit,
} from "#/server/modules";
import { type SubmissionMove, decideSubmission, isLate } from "#/server/submission-lifecycle";
import {
	DraftInput,
	GradeInput,
	ReturnInput,
	getMySubmission,
	grade,
	listSubmissions,
	returnSubmission,
	saveDraft,
	submit,
} from "#/server/submissions";
import { classWithStudent, inviteOk, makeUser } from "#/test/fixtures";
import { acceptInvite } from "#/server/classes";

const DAY = 24 * 60 * 60 * 1000;

const criteria = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: "C", maxPoints: 1 }));

const RUBRIC = [
	{ id: "isi", title: "Isi", maxPoints: 6 },
	{ id: "bahasa", title: "Bahasa", maxPoints: 4 },
];

type AssignmentOptions = {
	accepts?: { text: boolean; files: boolean };
	rubric?: unknown;
};
const assignment = ({ accepts = { text: true, files: true }, rubric }: AssignmentOptions = {}) =>
	StepInput.assert({
		kind: "assignment",
		title: "Laporan praktikum",
		content: { prompt: "Tulis laporanmu.", accepts, ...(rubric !== undefined && { rubric }) },
	});
const reflection = () =>
	StepInput.assert({
		kind: "reflection",
		title: "Refleksi",
		content: { prompt: "Apa kesulitanmu?" },
	});

async function stepIn(teacher: UserId, classId: ClassId, input: StepInput, dueAt?: Date) {
	const created = await createModule(
		teacher,
		classId,
		ModuleInput.assert({ title: "Bab 1", ...(dueAt && { dueAt }) }),
	);
	if (!created.ok) throw new Error(`createModule failed: ${created.reason}`);
	const made = await createStep(teacher, created.module.id, input);
	if (!made.ok) throw new Error(`createStep failed: ${made.reason}`);
	return made.step.id;
}

async function classWithAssignment(
	options: AssignmentOptions & { dueAt?: Date; prefix?: string } = {},
) {
	const people = await classWithStudent(options.prefix);
	const stepId = await stepIn(people.guru, people.classId, assignment(options), options.dueAt);
	return { ...people, stepId };
}

const draft = (text: string) => DraftInput.assert({ text });
const comment = (text: string) => ReturnInput.assert({ comment: text });
const gradeInput = (input: unknown) => GradeInput.assert(input);

async function submitted(student: UserId, stepId: StepId, text = "Laporan saya") {
	const saved = await saveDraft(student, stepId, draft(text));
	if (!saved.ok) throw new Error(`saveDraft failed: ${saved.reason}`);
	const result = await submit(student, stepId);
	if (!result.ok) throw new Error(`submit failed: ${result.reason}`);
	return result.submission.id;
}

async function statusOf(student: UserId, classId: ClassId, stepId: StepId) {
	const result = await progressFor(student, classId);
	if (!result.ok) throw new Error(`progressFor failed: ${result.reason}`);
	return result.progress.find((p) => p.stepId === stepId)?.status;
}

async function mine(student: UserId, stepId: StepId) {
	const result = await getMySubmission(student, stepId);
	if (!result.ok) throw new Error(`getMySubmission failed: ${result.reason}`);
	return result.submission;
}

afterEach(() => {
	vi.useRealTimers();
});

describe("the lifecycle table", () => {
	// Written from docs/data-model.md, not from the code: every move the table allows, the repeats
	// that change nothing, and a refusal for everything else.
	const allowed: Record<string, SubmissionStatus> = {
		"draft save student": "draft",
		"returned save student": "returned",
		"draft submit student": "submitted",
		"submitted return teacher": "returned",
		"returned submit student": "submitted",
		"submitted grade teacher": "graded",
	};
	const repeats = new Set([
		"submitted submit student",
		"returned return teacher",
		"graded grade teacher",
	]);
	const owner: Record<SubmissionMove, ClassRole> = {
		save: "student",
		submit: "student",
		return: "teacher",
		grade: "teacher",
	};
	const statuses: SubmissionStatus[] = ["draft", "submitted", "returned", "graded"];
	const moves: SubmissionMove[] = ["save", "submit", "return", "grade"];
	const roles: ClassRole[] = ["student", "teacher"];

	it("allows exactly the table's moves, by the right role", () => {
		for (const from of statuses) {
			for (const action of moves) {
				for (const role of roles) {
					const key = `${from} ${action} ${role}`;
					const decision = decideSubmission(action, from, role);
					if (role !== owner[action]) {
						expect(decision, key).toEqual({ ok: false, reason: "forbidden" });
					} else if (allowed[key]) {
						expect(decision, key).toEqual({ ok: true, to: allowed[key], repeat: false });
					} else if (repeats.has(key)) {
						expect(decision, key).toEqual({ ok: true, to: from, repeat: true });
					} else {
						expect(decision, key).toEqual({ ok: false, reason: "wrong_status" });
					}
				}
			}
		}
	});
});

describe("submitting and resubmitting", () => {
	it("moves draft to submitted, and status follows", async () => {
		const { siswa, classId, stepId } = await classWithAssignment();
		expect(await statusOf(siswa, classId, stepId)).toBe("not_started");
		await recordVisit(siswa, stepId, "opened");
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		const saved = await saveDraft(siswa, stepId, draft("Bagian awal"));
		expect(saved.ok && saved.submission.status).toBe("draft");
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		const result = await submit(siswa, stepId);
		expect(result.ok && result.submission.status).toBe("submitted");
		expect(result.ok && result.submission.submittedAt).toBeInstanceOf(Date);
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("resubmits after a return, keeping the history and the first submit time", async () => {
		const { guru, siswa, classId, stepId } = await classWithAssignment();
		const id = await submitted(siswa, stepId, "Versi 1");
		const first = (await mine(siswa, stepId))?.submittedAt;

		const returned = await returnSubmission(guru, id, comment("Tambahkan grafik."));
		expect(returned.ok && returned.submission.status).toBe("returned");
		expect(await statusOf(siswa, classId, stepId)).toBe("needs_help");
		expect(await mine(siswa, stepId)).toMatchObject({
			status: "returned",
			comment: "Tambahkan grafik.",
		});

		expect((await saveDraft(siswa, stepId, draft("Versi 2"))).ok).toBe(true);
		const again = await submit(siswa, stepId);
		expect(again).toMatchObject({ ok: true, changed: true });

		const view = await mine(siswa, stepId);
		expect(view).toMatchObject({ status: "submitted", text: "Versi 2", submittedAt: first });
		expect(view?.events.map((e) => [e.action, e.comment])).toEqual([
			["submit", null],
			["return", "Tambahkan grafik."],
			["submit", null],
		]);
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("grades, and graded is final", async () => {
		const { guru, siswa, classId, stepId } = await classWithAssignment();
		const id = await submitted(siswa, stepId);
		const graded = await grade(guru, id, gradeInput({ score: 85, comment: "Bagus" }));
		expect(graded).toMatchObject({
			ok: true,
			changed: true,
			submission: { status: "graded", score: 85, comment: "Bagus" },
		});
		expect(await statusOf(siswa, classId, stepId)).toBe("graded");

		expect(await saveDraft(siswa, stepId, draft("ubah"))).toMatchObject({
			ok: false,
			reason: "wrong_status",
			status: "graded",
		});
		expect(await submit(siswa, stepId)).toMatchObject({ ok: false, reason: "wrong_status" });
		expect(await returnSubmission(guru, id, comment("Ulangi"))).toMatchObject({
			ok: false,
			reason: "wrong_status",
		});
		expect(await mine(siswa, stepId)).toMatchObject({ status: "graded", text: "Laporan saya" });
	});

	it("refuses moves the table doesn't have", async () => {
		const { guru, siswa, stepId } = await classWithAssignment();
		expect(await submit(siswa, stepId)).toMatchObject({ ok: false, reason: "empty" });

		const saved = await saveDraft(siswa, stepId, draft("   "));
		if (!saved.ok) throw new Error(saved.reason);
		expect(await submit(siswa, stepId)).toMatchObject({ ok: false, reason: "empty" });
		const id = saved.submission.id;
		expect(await returnSubmission(guru, id, comment("x"))).toMatchObject({
			ok: false,
			reason: "wrong_status",
			status: "draft",
		});
		expect(await grade(guru, id, gradeInput({ score: 50 }))).toMatchObject({
			ok: false,
			reason: "wrong_status",
		});

		await submitted(siswa, stepId);
		expect(await saveDraft(siswa, stepId, draft("telat"))).toMatchObject({
			ok: false,
			reason: "wrong_status",
			status: "submitted",
		});
		await returnSubmission(guru, id, comment("Perbaiki"));
		expect(await grade(guru, id, gradeInput({ score: 50 }))).toMatchObject({
			ok: false,
			reason: "wrong_status",
			status: "returned",
		});
	});

	it("treats a repeated move as done once, and refuses a different repeat", async () => {
		const { guru, siswa, stepId } = await classWithAssignment();
		const id = await submitted(siswa, stepId);
		expect(await submit(siswa, stepId)).toMatchObject({ ok: true, changed: false });

		await returnSubmission(guru, id, comment("Perbaiki"));
		expect(await returnSubmission(guru, id, comment("Perbaiki"))).toMatchObject({
			ok: true,
			changed: false,
		});
		expect(await returnSubmission(guru, id, comment("Lain"))).toMatchObject({
			ok: false,
			reason: "wrong_status",
		});

		await submit(siswa, stepId);
		await grade(guru, id, gradeInput({ score: 70 }));
		expect(await grade(guru, id, gradeInput({ score: 70 }))).toMatchObject({
			ok: true,
			changed: false,
		});
		expect(await grade(guru, id, gradeInput({ score: 90 }))).toMatchObject({
			ok: false,
			reason: "wrong_status",
		});
		const view = await mine(siswa, stepId);
		expect(view?.score).toBe(70);
		expect(view?.events.map((e) => e.action)).toEqual(["submit", "return", "submit", "grade"]);
	});

	it("needs a comment to return work", () => {
		expect(ReturnInput({ comment: "   " })).toBeInstanceOf(type.errors);
		expect(ReturnInput({ comment: " Perbaiki " })).toEqual({ comment: "Perbaiki" });
	});

	it("keeps a racing submit and return in a legal order", async () => {
		const runs = await Promise.all(
			Array.from({ length: 5 }, async (_, run) => {
				const { guru, siswa, stepId } = await classWithAssignment({ prefix: `r${run}` });
				const id = await submitted(siswa, stepId);
				// A repeated submit and a return race. Either order is legal, and neither is lost.
				const [sent, back] = await Promise.all([
					submit(siswa, stepId),
					returnSubmission(guru, id, comment("Perbaiki")),
				]);
				return { sent, back, view: await mine(siswa, stepId) };
			}),
		);
		for (const { sent, back, view } of runs) {
			expect(back).toMatchObject({ ok: true, changed: true });
			const actions = view?.events.map((e) => e.action);
			if (sent.ok && sent.changed) {
				// The return went first, so the submit was a real resubmit after it.
				expect(view?.status).toBe("submitted");
				expect(actions).toEqual(["submit", "return", "submit"]);
			} else {
				// The submit went first as a repeat, then the return.
				expect(sent).toMatchObject({ ok: true, changed: false });
				expect(view?.status).toBe("returned");
				expect(actions).toEqual(["submit", "return"]);
			}
		}
	});

	it("lets only one of a racing return and grade through", async () => {
		const runs = await Promise.all(
			Array.from({ length: 5 }, async (_, run) => {
				const { guru, siswa, stepId } = await classWithAssignment({ prefix: `g${run}` });
				const id = await submitted(siswa, stepId);
				const [back, graded] = await Promise.all([
					returnSubmission(guru, id, comment("Perbaiki")),
					grade(guru, id, gradeInput({ score: 60 })),
				]);
				return { back, graded, view: await mine(siswa, stepId) };
			}),
		);
		for (const { back, graded, view } of runs) {
			expect([back.ok, graded.ok].filter(Boolean)).toHaveLength(1);
			expect(view?.status).toBe(back.ok ? "returned" : "graded");
			expect(view?.events).toHaveLength(2);
		}
	});
});

describe("grading", () => {
	it("checks rubric points against the step's rubric", async () => {
		const { guru, siswa, stepId } = await classWithAssignment({ rubric: RUBRIC });
		const id = await submitted(siswa, stepId);
		const refused = async (input: unknown) =>
			expect(await grade(guru, id, gradeInput(input))).toMatchObject({
				ok: false,
				reason: "invalid_grade",
			});
		await refused({ points: { isi: 5 } });
		await refused({ points: { isi: 7, bahasa: 4 } });
		await refused({ points: { isi: -1, bahasa: 4 } });
		await refused({ points: { isi: 5, bahasa: 4, lain: 1 } });
		await refused({ score: 80 });
		await refused({ points: { isi: 5, bahasa: 4 }, score: 9 });
		expect(GradeInput({ points: { isi: 5.5 } })).toBeInstanceOf(type.errors);
		expect(GradeInput({ score: 50, extra: 1 })).toBeInstanceOf(type.errors);

		const ok = await grade(guru, id, gradeInput({ points: { isi: 6, bahasa: 3 } }));
		expect(ok).toMatchObject({
			ok: true,
			submission: { score: 9, rubricScores: { isi: 6, bahasa: 3 }, comment: null },
		});
	});

	it("takes a 0 to 100 score when there is no rubric", async () => {
		const { guru, siswa, stepId } = await classWithAssignment();
		const id = await submitted(siswa, stepId);
		const bad = [{ score: 101 }, { score: -1 }, {}, { points: { isi: 1 } }];
		for (const result of await Promise.all(bad.map((g) => grade(guru, id, gradeInput(g))))) {
			expect(result).toMatchObject({ reason: "invalid_grade" });
		}
		expect(await grade(guru, id, gradeInput({ score: 0 }))).toMatchObject({
			ok: true,
			submission: { score: 0, rubricScores: null },
		});
	});

	it("refuses a rubric that can't be graded", () => {
		const withRubric = (rubric: unknown) =>
			StepInput({ kind: "assignment", title: "T", content: { prompt: "P", accepts, rubric } });
		const accepts = { text: true, files: false };
		expect(withRubric(criteria(20))).not.toBeInstanceOf(type.errors);
		for (const rubric of [
			[],
			criteria(21),
			[...RUBRIC, { id: "isi", title: "Lagi", maxPoints: 2 }],
			[{ id: "a", title: "A", maxPoints: 0 }],
		]) {
			expect(withRubric(rubric)).toBeInstanceOf(type.errors);
		}
		const neither = { prompt: "P", accepts: { text: false, files: false } };
		expect(StepInput({ kind: "assignment", title: "T", content: neither })).toBeInstanceOf(
			type.errors,
		);
	});
});

describe("reflections", () => {
	it("are text only, can be returned, and are never graded", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const stepId = await stepIn(guru, classId, reflection());
		const id = await submitted(siswa, stepId, "Saya kesulitan di grafik.");
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
		expect(await grade(guru, id, gradeInput({ score: 80 }))).toMatchObject({
			ok: false,
			reason: "not_scored",
		});
		expect((await returnSubmission(guru, id, comment("Ceritakan lebih banyak."))).ok).toBe(true);
		expect(await statusOf(siswa, classId, stepId)).toBe("needs_help");
	});

	it("refuses text on an assignment that takes only files", async () => {
		const { siswa, stepId } = await classWithAssignment({ accepts: { text: false, files: true } });
		expect(await saveDraft(siswa, stepId, draft("teks"))).toMatchObject({
			ok: false,
			reason: "text_not_accepted",
		});
		expect(await submit(siswa, stepId)).toMatchObject({ ok: false, reason: "empty" });
	});
});

describe("lateness", () => {
	it.each([
		["a millisecond before", -1, false],
		["exactly at", 0, false],
		["a millisecond after", 1, true],
	])("submitting %s the due date gives late = %s", async (_, offset, late) => {
		const due = new Date(Date.now() + DAY);
		const { guru, siswa, stepId } = await classWithAssignment({ dueAt: due });
		await saveDraft(siswa, stepId, draft("Laporan"));
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(due.getTime() + offset);
		await submit(siswa, stepId);
		vi.useRealTimers();
		expect((await mine(siswa, stepId))?.late).toBe(late);
		const list = await listSubmissions(guru, stepId);
		expect(list.ok && list.students[0]?.submission?.late).toBe(late);
	});

	it("is never late without a due date", async () => {
		const { siswa, stepId } = await classWithAssignment();
		await submitted(siswa, stepId);
		expect((await mine(siswa, stepId))?.late).toBe(false);
		expect(isLate(new Date(), null)).toBe(false);
		expect(isLate(null, new Date(0))).toBe(false);
	});

	it("judges a resubmit after a return on the first submit", async () => {
		const due = new Date(Date.now() + DAY);
		const { guru, siswa, stepId } = await classWithAssignment({ dueAt: due });
		const id = await submitted(siswa, stepId);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(due.getTime() + DAY);
		await returnSubmission(guru, id, comment("Perbaiki"));
		await submit(siswa, stepId);
		vi.useRealTimers();
		expect(await mine(siswa, stepId)).toMatchObject({ status: "submitted", late: false });
	});
});

describe("who sees and moves submissions", () => {
	it("keeps non-members out with not_found", async () => {
		const { guru, siswa, orang, stepId } = await classWithAssignment();
		const id = await submitted(siswa, stepId);
		const notFound = { ok: false, reason: "not_found" };
		expect(await getMySubmission(orang, stepId)).toEqual(notFound);
		expect(await saveDraft(orang, stepId, draft("x"))).toEqual(notFound);
		expect(await submit(orang, stepId)).toEqual(notFound);
		expect(await listSubmissions(orang, stepId)).toEqual(notFound);
		expect(await returnSubmission(orang, id, comment("x"))).toEqual(notFound);
		expect(await grade(orang, id, gradeInput({ score: 1 }))).toEqual(notFound);
		const unknown = SubmissionId.assert(randomUUID());
		expect(await grade(guru, unknown, gradeInput({ score: 1 }))).toEqual(notFound);
	});

	it("lets students hand in and teachers judge, not the other way round", async () => {
		const { guru, siswa, stepId } = await classWithAssignment();
		const id = await submitted(siswa, stepId);
		const forbidden = { ok: false, reason: "forbidden" };
		expect(await saveDraft(guru, stepId, draft("x"))).toEqual(forbidden);
		expect(await getMySubmission(guru, stepId)).toEqual(forbidden);
		expect(await listSubmissions(siswa, stepId)).toEqual(forbidden);
		expect(await returnSubmission(siswa, id, comment("x"))).toEqual(forbidden);
		expect(await grade(siswa, id, gradeInput({ score: 100 }))).toEqual(forbidden);
	});

	it("shows a student only their own work, and the teacher everyone's", async () => {
		const { guru, siswa, classId, stepId } = await classWithAssignment();
		const kedua = await makeUser("kedua");
		await acceptInvite(kedua, await inviteOk(guru, classId, "kedua"));
		await submitted(siswa, stepId, "Punya siswa");

		expect(await mine(kedua, stepId)).toBeNull();
		const list = await listSubmissions(guru, stepId);
		if (!list.ok) throw new Error(list.reason);
		expect(list.students.map((s) => [s.username, s.submission?.text ?? null])).toEqual([
			["kedua", null],
			["siswa", "Punya siswa"],
		]);

		const progress = await classProgress(guru, classId);
		if (!progress.ok) throw new Error(progress.reason);
		const statuses = progress.students.map((s) => [s.username, s.progress[0]?.status]);
		expect(statuses).toEqual([
			["siswa", "done"],
			["kedua", "not_started"],
		]);
	});

	it("refuses submissions on steps that take none", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const stepId = await stepIn(
			guru,
			classId,
			StepInput.assert({ kind: "reading", title: "Baca", content: { body: "Isi" } }),
		);
		expect(await saveDraft(siswa, stepId, draft("x"))).toEqual({
			ok: false,
			reason: "not_a_submission_step",
		});
		expect(await listSubmissions(guru, stepId)).toEqual({
			ok: false,
			reason: "not_a_submission_step",
		});
	});
});
