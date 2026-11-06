// Owns: tests for quiz questions, attempts, quiz status, and keeping answer keys away from students, against the test database. Not here: grading rules per question kind (src/server/question-kinds.test.ts) or test setup (src/test/).

import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db/client";
import { type ClassId, QuestionId, type StepId, type UserId } from "#/db/ids";
import { quizAttempt } from "#/db/quiz-schema";
import {
	ModuleInput,
	StepInput,
	classProgress,
	createModule,
	createStep,
	getStep,
	listModules,
	progressFor,
	recordVisit,
	updateStep,
} from "#/server/modules";
import {
	type AnswersInput,
	QuestionInput,
	createQuestion,
	deleteQuestion,
	getQuiz,
	quizAttempts,
	reorderQuestions,
	submitAttempt,
	teacherQuiz,
	updateQuestion,
} from "#/server/quizzes";
import { classWithStudent } from "#/test/fixtures";

type Settings = { maxAttempts?: number; passScore?: number };

const quizInput = (settings: Settings = {}) =>
	StepInput.assert({ kind: "quiz", title: "Kuis 1", content: settings });

const choices = [
	{ id: "a", text: "1 N" },
	{ id: "b", text: "2 N" },
	{ id: "c", text: "3 N" },
];

// Two questions: a single choice whose answer is "b", and g = 9.8 ± 0.1.
const pilihan = (correct = "b") =>
	QuestionInput.assert({ kind: "single_choice", prompt: "Pilih satu", choices, correct });
const angka = () =>
	QuestionInput.assert({ kind: "number", prompt: "g?", correct: { value: 9.8, tolerance: 0.1 } });

async function quizStep(teacher: UserId, classId: ClassId, settings?: Settings) {
	const mod = await createModule(teacher, classId, ModuleInput.assert({ title: "Bab 1" }));
	if (!mod.ok) throw new Error(`createModule failed: ${mod.reason}`);
	const created = await createStep(teacher, mod.module.id, quizInput(settings));
	if (!created.ok) throw new Error(`createStep failed: ${created.reason}`);
	return { moduleId: mod.module.id, stepId: created.step.id };
}

async function questionOk(teacher: UserId, stepId: StepId, input: QuestionInput) {
	const result = await createQuestion(teacher, stepId, input);
	if (!result.ok) throw new Error(`createQuestion failed: ${result.reason}`);
	return result.question.id;
}

// A class with a student, and one quiz holding `pilihan` then `angka`.
async function classWithQuiz(settings?: Settings) {
	const people = await classWithStudent();
	const { moduleId, stepId } = await quizStep(people.guru, people.classId, settings);
	const choiceQ = await questionOk(people.guru, stepId, pilihan());
	const numberQ = await questionOk(people.guru, stepId, angka());
	const answers = {
		bothRight: { [choiceQ]: "b", [numberQ]: 9.85 },
		oneRight: { [choiceQ]: "b", [numberQ]: 10 },
		bothWrong: { [choiceQ]: "a", [numberQ]: 10 },
	} satisfies Record<string, AnswersInput>;
	return { ...people, moduleId, stepId, choiceQ, numberQ, answers };
}

async function submitOk(student: UserId, stepId: StepId, answers: AnswersInput) {
	const result = await submitAttempt(student, stepId, answers);
	if (!result.ok) throw new Error(`submitAttempt failed: ${result.reason}`);
	return result;
}

async function statusOf(student: UserId, classId: ClassId, stepId: StepId) {
	const result = await progressFor(student, classId);
	if (!result.ok) throw new Error(`progressFor failed: ${result.reason}`);
	return result.progress.find((p) => p.stepId === stepId)?.status;
}

async function teacherSees(teacher: UserId, classId: ClassId, student: UserId, stepId: StepId) {
	const result = await classProgress(teacher, classId);
	if (!result.ok) throw new Error(`classProgress failed: ${result.reason}`);
	return result.students
		.find((s) => s.userId === student)
		?.progress.find((p) => p.stepId === stepId)?.status;
}

async function attemptRows(stepId: StepId, student: UserId) {
	return db
		.select()
		.from(quizAttempt)
		.where(and(eq(quizAttempt.stepId, stepId), eq(quizAttempt.studentId, student)));
}

describe("quiz settings", () => {
	it("default to 3 attempts and a pass score of 70", () => {
		expect(quizInput().content).toEqual({ maxAttempts: 3, passScore: 70 });
		expect(quizInput({ maxAttempts: 1, passScore: 100 }).content).toEqual({
			maxAttempts: 1,
			passScore: 100,
		});
		for (const content of [{ maxAttempts: 0 }, { maxAttempts: 11 }, { passScore: 101 }]) {
			expect(StepInput({ kind: "quiz", title: "x", content })).toBeInstanceOf(type.errors);
		}
	});

	it("a quiz can't be marked finished by the student", async () => {
		const { siswa, stepId } = await classWithQuiz();
		expect(await recordVisit(siswa, stepId, "finished")).toEqual({
			ok: false,
			reason: "not_finishable",
		});
	});
});

describe("quiz status", () => {
	it("goes not started, in progress, then needs help after the last failed attempt", async () => {
		const { siswa, guru, classId, stepId, answers } = await classWithQuiz();
		expect(await statusOf(siswa, classId, stepId)).toBe("not_started");
		await recordVisit(siswa, stepId, "opened");
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		const first = await submitOk(siswa, stepId, answers.oneRight);
		expect(first).toMatchObject({ attempt: { attemptNumber: 1, score: 50 }, attemptsLeft: 2 });
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
		await submitOk(siswa, stepId, answers.bothWrong);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		const last = await submitOk(siswa, stepId, answers.oneRight);
		expect(last).toMatchObject({ passed: false, attemptsLeft: 0 });
		expect(await statusOf(siswa, classId, stepId)).toBe("needs_help");
		expect(await teacherSees(guru, classId, siswa, stepId)).toBe("needs_help");

		expect(await submitAttempt(siswa, stepId, answers.bothRight)).toEqual({
			ok: false,
			reason: "no_attempts_left",
		});
		expect(await attemptRows(stepId, siswa)).toHaveLength(3);
	});

	it("an attempt alone, with no visit, counts as in progress", async () => {
		const { siswa, classId, stepId, answers } = await classWithQuiz();
		await submitOk(siswa, stepId, answers.bothWrong);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
	});

	it("the best attempt counts: a fail then a pass is done, and the quiz closes", async () => {
		const { siswa, guru, classId, stepId, answers } = await classWithQuiz();
		await submitOk(siswa, stepId, answers.oneRight);
		const pass = await submitOk(siswa, stepId, answers.bothRight);
		expect(pass).toMatchObject({ attempt: { attemptNumber: 2, score: 100 }, passed: true });
		expect(pass.attemptsLeft).toBe(0);
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
		expect(await teacherSees(guru, classId, siswa, stepId)).toBe("done");

		// No retry after a pass: the pass already showed the solutions.
		expect(await submitAttempt(siswa, stepId, answers.bothWrong)).toEqual({
			ok: false,
			reason: "already_passed",
		});
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("a pass on the last attempt is done, not needs help", async () => {
		const { siswa, classId, stepId, answers } = await classWithQuiz({ maxAttempts: 2 });
		await submitOk(siswa, stepId, answers.bothWrong);
		await submitOk(siswa, stepId, answers.bothRight);
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("scores round down, and settings are read live", async () => {
		const { siswa, guru, classId, stepId, choiceQ, numberQ } = await classWithQuiz({
			passScore: 67,
		});
		const third = await questionOk(
			guru,
			stepId,
			QuestionInput.assert({ kind: "short_text", prompt: "Satuan gaya?", correct: "Newton" }),
		);
		const twoOfThree = await submitOk(siswa, stepId, {
			[choiceQ]: "b",
			[numberQ]: 9.8,
			[third]: "joule",
		});
		expect(twoOfThree).toMatchObject({ attempt: { score: 66 }, passed: false });
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		// The teacher lowers the pass score to the rounded-down value: 66.67% now passes.
		await updateStep(guru, stepId, quizInput({ passScore: 66 }));
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("a teacher raising max attempts reopens a quiz that ran out", async () => {
		const { siswa, guru, classId, stepId, answers } = await classWithQuiz({ maxAttempts: 1 });
		await submitOk(siswa, stepId, answers.bothWrong);
		expect(await statusOf(siswa, classId, stepId)).toBe("needs_help");
		await updateStep(guru, stepId, quizInput({ maxAttempts: 2 }));
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
		expect(await submitOk(siswa, stepId, answers.bothRight)).toMatchObject({
			attempt: { attemptNumber: 2 },
			passed: true,
		});
	});
});

describe("attempt limits", () => {
	it("submits at the same moment never go past max attempts or share a number", async () => {
		const { siswa, stepId, answers } = await classWithQuiz({ maxAttempts: 2 });
		const results = await Promise.all(
			Array.from({ length: 5 }, () => submitAttempt(siswa, stepId, answers.bothWrong)),
		);
		const accepted = results.filter((r) => r.ok);
		const refused = results.filter((r) => !r.ok);
		expect(new Set(accepted.map((r) => r.ok && r.attempt.attemptNumber))).toEqual(new Set([1, 2]));
		expect(refused).toEqual(
			Array.from({ length: 3 }, () => ({ ok: false, reason: "no_attempts_left" })),
		);
		const rows = await attemptRows(stepId, siswa);
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((r) => r.attemptNumber))).toEqual(new Set([1, 2]));
	});

	it("refuses answers of the wrong shape or for unknown questions, and stores nothing", async () => {
		const { siswa, stepId, choiceQ, numberQ } = await classWithQuiz();
		expect(await submitAttempt(siswa, stepId, { [choiceQ]: "b", [numberQ]: "9.8" })).toEqual({
			ok: false,
			reason: "invalid_answer",
			questionId: numberQ,
		});
		expect(await submitAttempt(siswa, stepId, { [choiceQ]: ["b"] })).toEqual({
			ok: false,
			reason: "invalid_answer",
			questionId: choiceQ,
		});
		const stranger = randomUUID();
		expect(await submitAttempt(siswa, stepId, { [stranger]: "b" })).toEqual({
			ok: false,
			reason: "invalid_answer",
			questionId: stranger,
		});
		expect(await attemptRows(stepId, siswa)).toHaveLength(0);
	});

	it("unanswered questions count as wrong", async () => {
		const { siswa, stepId, choiceQ, numberQ } = await classWithQuiz();
		const result = await submitOk(siswa, stepId, { [choiceQ]: "b" });
		expect(result.attempt.score).toBe(50);
		expect(result.results).toEqual([
			{ questionId: choiceQ, correct: true },
			{ questionId: numberQ, correct: false },
		]);
	});

	it("a quiz with no questions can't be submitted", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const { stepId } = await quizStep(guru, classId);
		expect(await submitAttempt(siswa, stepId, {})).toEqual({ ok: false, reason: "no_questions" });
	});
});

// Distinctive values that live only in question_key. None may appear in anything a student
// receives while the quiz is open.
const MARKERS = {
	feedback: "FEEDBACK-MARKER-7f3a",
	solution: "SOLUTION-MARKER-9c1e",
	numberValue: 98765.4321,
	tolerance: 0.0137,
	shortText: "kunci-rahasia-zq",
};
const markerStrings = Object.values(MARKERS).map(String);

// A quiz whose keys hold every marker, plus a single and a multiple choice question.
async function quizWithMarkers(teacher: UserId, classId: ClassId, correctChoice: string) {
	const { stepId } = await quizStep(teacher, classId);
	const ids = [
		await questionOk(
			teacher,
			stepId,
			QuestionInput.assert({
				kind: "number",
				prompt: "Berapa?",
				correct: { value: MARKERS.numberValue, tolerance: MARKERS.tolerance },
				feedback: MARKERS.feedback,
				solution: MARKERS.solution,
			}),
		),
		await questionOk(
			teacher,
			stepId,
			QuestionInput.assert({ kind: "short_text", prompt: "Kata?", correct: MARKERS.shortText }),
		),
		await questionOk(
			teacher,
			stepId,
			QuestionInput.assert({
				kind: "single_choice",
				prompt: "Satu?",
				choices,
				correct: correctChoice,
			}),
		),
		await questionOk(
			teacher,
			stepId,
			QuestionInput.assert({
				kind: "multiple_choice",
				prompt: "Banyak?",
				choices,
				correct: [correctChoice, "c"],
			}),
		),
	];
	return { stepId, ids };
}

// Fails on anything JSON.stringify would quietly drop or flatten, such as a Map, a Set, or a function.
function assertPlainJson(value: unknown, path = "payload"): void {
	if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
	if (value instanceof Date) return;
	if (Array.isArray(value)) {
		value.forEach((item, i) => assertPlainJson(item, `${path}[${i}]`));
		return;
	}
	if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		for (const [key, item] of Object.entries(value)) assertPlainJson(item, `${path}.${key}`);
		return;
	}
	throw new Error(`${path} is not plain JSON: ${Object.prototype.toString.call(value)}`);
}

const leaked = (payload: unknown) => {
	assertPlainJson(payload);
	const text = JSON.stringify(payload);
	return markerStrings.filter((marker) => text.includes(marker));
};

describe("answer keys stay on the server", () => {
	it("nothing a student receives while attempts remain holds a key", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const { stepId, ids } = await quizWithMarkers(guru, classId, "a");
		const wrong = { [ids[0]]: 1, [ids[1]]: "salah", [ids[2]]: "b", [ids[3]]: ["b"] };

		const payloads = {
			listModules: await listModules(siswa, classId),
			getStep: await getStep(siswa, stepId),
			progress: await progressFor(siswa, classId),
			quizBefore: await getQuiz(siswa, stepId),
			submit1: await submitAttempt(siswa, stepId, wrong),
			submit2: await submitAttempt(siswa, stepId, wrong),
			quizAfter: await getQuiz(siswa, stepId),
		};
		for (const [name, payload] of Object.entries(payloads)) {
			expect({ name, leaked: leaked(payload) }).toEqual({ name, leaked: [] });
		}
		expect(payloads.quizAfter).toMatchObject({ ok: true, attemptsLeft: 1, reveal: null });
		expect(payloads.submit2).toMatchObject({ ok: true, reveal: null });
		if (!payloads.submit2.ok) throw new Error("submit2 failed");
		for (const result of payloads.submit2.results) {
			expect(new Set(Object.keys(result))).toEqual(new Set(["questionId", "correct"]));
		}
	});

	it("which choice is correct changes nothing a student sees before the quiz closes", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const quizA = await quizWithMarkers(guru, classId, "a");
		const quizB = await quizWithMarkers(guru, classId, "b");
		// Question ids differ between the two quizzes, so each is swapped for its position.
		const seen = async ({ stepId, ids }: { stepId: StepId; ids: string[] }) => {
			const step = await getStep(siswa, stepId);
			const payload = { quiz: await getQuiz(siswa, stepId), content: step.ok && step.step.content };
			return ids.reduce(
				(text, id, i) => text.replaceAll(id, `Q${i}`),
				JSON.stringify(payload).replaceAll(stepId, "STEP"),
			);
		};
		expect(await seen(quizA)).toBe(await seen(quizB));
	});

	it("the markers are visible to the teacher, and to the student once attempts run out", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const { stepId, ids } = await quizWithMarkers(guru, classId, "a");
		expect(leaked(await teacherQuiz(guru, stepId))).toEqual(markerStrings);

		const wrong = { [ids[0]]: 1 };
		await submitOk(siswa, stepId, wrong);
		await submitOk(siswa, stepId, wrong);
		const last = await submitOk(siswa, stepId, wrong);
		expect(leaked(last)).toEqual(markerStrings);
		const quiz = await getQuiz(siswa, stepId);
		expect(leaked(quiz)).toEqual(markerStrings);
		expect(quiz).toMatchObject({
			ok: true,
			reveal: [
				{
					questionId: ids[0],
					correct: { value: MARKERS.numberValue, tolerance: MARKERS.tolerance },
					feedback: MARKERS.feedback,
					solution: MARKERS.solution,
				},
				{ questionId: ids[1], correct: MARKERS.shortText },
				{ questionId: ids[2], correct: "a" },
				{ questionId: ids[3], correct: ["a", "c"] },
			],
		});
	});

	it("a pass also reveals the solutions", async () => {
		const { siswa, stepId, answers } = await classWithQuiz();
		const pass = await submitOk(siswa, stepId, answers.bothRight);
		expect(pass.reveal).toHaveLength(2);
	});
});

describe("who can do what", () => {
	it("students can't touch questions or see keys and attempts", async () => {
		const { siswa, stepId, choiceQ, numberQ } = await classWithQuiz();
		const forbidden = { ok: false, reason: "forbidden" };
		expect(await createQuestion(siswa, stepId, pilihan())).toEqual(forbidden);
		expect(await updateQuestion(siswa, choiceQ, pilihan("a"))).toEqual(forbidden);
		expect(await deleteQuestion(siswa, choiceQ)).toEqual(forbidden);
		expect(await reorderQuestions(siswa, stepId, [numberQ, choiceQ])).toEqual(forbidden);
		expect(await teacherQuiz(siswa, stepId)).toEqual(forbidden);
		expect(await quizAttempts(siswa, stepId)).toEqual(forbidden);
	});

	it("teachers don't take quizzes", async () => {
		const { guru, stepId, answers } = await classWithQuiz();
		expect(await submitAttempt(guru, stepId, answers.bothRight)).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(await getQuiz(guru, stepId)).toEqual({ ok: false, reason: "forbidden" });
	});

	it("non-members get not found from every quiz operation", async () => {
		const { orang, stepId, choiceQ, numberQ, answers } = await classWithQuiz();
		const notFound = { ok: false, reason: "not_found" };
		expect(await getQuiz(orang, stepId)).toEqual(notFound);
		expect(await submitAttempt(orang, stepId, answers.bothRight)).toEqual(notFound);
		expect(await teacherQuiz(orang, stepId)).toEqual(notFound);
		expect(await quizAttempts(orang, stepId)).toEqual(notFound);
		expect(await createQuestion(orang, stepId, pilihan())).toEqual(notFound);
		expect(await updateQuestion(orang, choiceQ, pilihan())).toEqual(notFound);
		expect(await deleteQuestion(orang, choiceQ)).toEqual(notFound);
		expect(await reorderQuestions(orang, stepId, [numberQ, choiceQ])).toEqual(notFound);
		expect(await deleteQuestion(orang, QuestionId.assert(randomUUID()))).toEqual(notFound);
	});

	it("quiz operations refuse steps that aren't quizzes", async () => {
		const { guru, siswa, moduleId } = await classWithQuiz();
		const reading = await createStep(
			guru,
			moduleId,
			StepInput.assert({ kind: "reading", title: "Baca", content: { body: "isi" } }),
		);
		if (!reading.ok) throw new Error("createStep failed");
		const notQuiz = { ok: false, reason: "not_a_quiz" };
		expect(await createQuestion(guru, reading.step.id, pilihan())).toEqual(notQuiz);
		expect(await getQuiz(siswa, reading.step.id)).toEqual(notQuiz);
		expect(await submitAttempt(siswa, reading.step.id, {})).toEqual(notQuiz);
	});
});

describe("teacher editing", () => {
	it("creates, updates, reorders, and deletes questions with their keys", async () => {
		const { guru, siswa, stepId, choiceQ, numberQ } = await classWithQuiz();
		const updated = await updateQuestion(
			guru,
			choiceQ,
			QuestionInput.assert({
				kind: "short_text",
				prompt: "Satuan gaya?",
				correct: "Newton",
				solution: "Lihat bab 2.",
			}),
		);
		expect(updated).toMatchObject({
			ok: true,
			question: { kind: "short_text", choices: null, correct: "Newton", solution: "Lihat bab 2." },
		});

		expect(await reorderQuestions(guru, stepId, [numberQ])).toEqual({
			ok: false,
			reason: "ids_mismatch",
		});
		expect(await reorderQuestions(guru, stepId, [numberQ, choiceQ])).toEqual({ ok: true });
		const third = await questionOk(guru, stepId, pilihan());
		expect(await deleteQuestion(guru, numberQ)).toEqual({ ok: true });

		const view = await teacherQuiz(guru, stepId);
		if (!view.ok) throw new Error("teacherQuiz failed");
		expect(view.questions.map((q) => [q.id, q.position])).toEqual([
			[choiceQ, 0],
			[third, 1],
		]);
		const student = await getQuiz(siswa, stepId);
		if (!student.ok) throw new Error("getQuiz failed");
		expect(student.questions.map((q) => q.id)).toEqual([choiceQ, third]);
	});

	it("the teacher sees every student's attempts with their answers", async () => {
		const { guru, siswa, stepId, answers } = await classWithQuiz();
		await submitOk(siswa, stepId, answers.oneRight);
		await submitOk(siswa, stepId, answers.bothRight);
		const result = await quizAttempts(guru, stepId);
		expect(result).toMatchObject({
			ok: true,
			attempts: [
				{ studentId: siswa, attemptNumber: 1, score: 50, answers: answers.oneRight },
				{ studentId: siswa, attemptNumber: 2, score: 100, answers: answers.bothRight },
			],
		});
	});
});
