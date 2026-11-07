// Owns: quiz questions with their answer keys, quiz attempts and grading, and the rule for when a student may see solutions. The one app module that reads question_key. Not here: each question kind's shapes and grading rule (src/server/question-kinds.ts), quiz status (src/server/step-kinds.ts), or session wiring (src/server/quiz-fns.ts).

import { type } from "arktype";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { user } from "#/db/auth-schema.gen";
import { classMember } from "#/db/class-schema";
import { moduleTable, step } from "#/db/content-schema";
import { db } from "#/db/client";
import type { QuestionId, StepId, UserId } from "#/db/ids";
import { questionKey } from "#/db/question-key-schema";
import { question, questionKind, quizAttempt } from "#/db/quiz-schema";
import { type Conn, NOT_FOUND, OK, type Tx, fail, lockClass } from "#/server/class-access";
import { contentOf, positionsIn, sameIds, stepFor, writeStep } from "#/server/modules";
import { QUESTION_KINDS, StoredAnswers, parseChoices } from "#/server/question-kinds";
import { Markdown, quizProgress } from "#/server/step-kinds";

export const QuestionKindInput = type.enumerated(...questionKind.enumValues);

// A question and its key in one input. `choices` only for choice kinds (null or left out for the
// others, so the editor can send back what teacherQuiz gave it), and `correct` must fit the kind
// and name only choices that exist.
export const QuestionInput = type({
	"+": "delete",
	kind: QuestionKindInput,
	prompt: Markdown.atLeastLength(1),
	"choices?": "unknown",
	correct: "unknown",
	feedback: Markdown.default(""),
	solution: Markdown.default(""),
}).pipe(({ kind, prompt, choices, correct, feedback, solution }, ctx) => {
	const spec = QUESTION_KINDS[kind];
	if (!spec.choices && choices != null) return ctx.error(`${kind} questions have no choices`);
	const parsedChoices = spec.choices ? parseChoices(choices) : null;
	if (parsedChoices instanceof type.errors) return ctx.error(`choices: ${parsedChoices.summary}`);
	const key = spec.parseKey(correct, new Set(parsedChoices?.map((c) => c.id)));
	if (typeof key === "string") return ctx.error(`correct for ${kind}: ${key}`);
	return { kind, prompt, choices: parsedChoices, key: { correct: key.key, feedback, solution } };
});
export type QuestionInput = typeof QuestionInput.infer;

// Answers keyed by question id. Each value is checked against its question's kind in submitAttempt.
export const AnswersInput = type("Record<string, unknown>");
export type AnswersInput = typeof AnswersInput.infer;

// What a student sees of a question. Every read goes through here, so raw jsonb is never trusted.
function toQuestion(row: typeof question.$inferSelect) {
	const choices = row.choices === null ? null : parseChoices(row.choices);
	if (choices instanceof type.errors) {
		throw new Error(`Question ${row.id} has invalid choices: ${choices.summary}`);
	}
	return { id: row.id, position: row.position, kind: row.kind, prompt: row.prompt, choices };
}

// A question with its key, for the teacher's editor.
function toTeacherQuestion(
	row: typeof question.$inferSelect,
	key: typeof questionKey.$inferSelect,
) {
	return {
		...toQuestion(row),
		correct: QUESTION_KINDS[row.kind].readKey(key.correct),
		feedback: key.feedback,
		solution: key.solution,
	};
}

// Students' questions select from `question` only. Keys are read only by the functions below that
// say so: the teacher's views, grading, and the reveal.
const questionsOf = (conn: Conn, stepId: StepId) =>
	conn.select().from(question).where(eq(question.stepId, stepId)).orderBy(asc(question.position));

const questionsWithKeys = (conn: Conn, stepId: StepId) =>
	conn
		.select({ question, key: questionKey })
		.from(question)
		.innerJoin(questionKey, eq(questionKey.questionId, question.id))
		.where(eq(question.stepId, stepId))
		.orderBy(asc(question.position));

// The correct answer, feedback, and solution of every question. Only after this student passes.
// Running out of attempts doesn't reveal them: a teacher can raise maxAttempts, and the student
// would retry with the answers in hand. Help after a failed quiz comes from the teacher or the tutor.
async function revealFor(conn: Conn, stepId: StepId) {
	const rows = await questionsWithKeys(conn, stepId);
	return rows.map(({ question: q, key }) => ({
		questionId: q.id,
		correct: QUESTION_KINDS[q.kind].readKey(key.correct),
		feedback: key.feedback,
		solution: key.solution,
	}));
}

// writeStep (class lock, then teacher check), for quiz steps only.
async function writeQuiz(tx: Tx, actor: UserId, stepId: StepId) {
	const access = await writeStep(tx, actor, stepId);
	if (!access.ok) return access;
	return access.kind === "quiz" ? access : fail("not_a_quiz");
}

// writeQuiz for the quiz that holds this question, plus the question as it is under the lock.
async function writeQuestion(tx: Tx, actor: UserId, questionId: QuestionId) {
	const [found] = await tx
		.select({ stepId: question.stepId })
		.from(question)
		.where(eq(question.id, questionId));
	if (!found) return NOT_FOUND;
	const access = await writeQuiz(tx, actor, found.stepId);
	if (!access.ok) return access;
	// Read again under the lock: a parallel delete may have removed it while we waited.
	const [locked] = await tx
		.select({ position: question.position })
		.from(question)
		.where(eq(question.id, questionId));
	return locked
		? ({ ok: true, stepId: found.stepId, position: locked.position } as const)
		: NOT_FOUND;
}

// A read of a quiz step by a member who can see it. Undefined when they shouldn't learn it exists.
async function readQuiz(conn: Conn, actor: UserId, stepId: StepId) {
	const access = await stepFor(conn, actor, stepId);
	if (!access) return undefined;
	const parsed = contentOf(access.step);
	return { role: access.role, classId: access.classId, parsed };
}

export async function createQuestion(actor: UserId, stepId: StepId, input: QuestionInput) {
	return db.transaction(async (tx) => {
		const access = await writeQuiz(tx, actor, stepId);
		if (!access.ok) return access;
		const [created] = await tx
			.insert(question)
			.values({
				stepId,
				kind: input.kind,
				prompt: input.prompt,
				choices: input.choices,
				position: sql`(select count(*) from ${question} where ${question.stepId} = ${stepId})`,
			})
			.returning();
		if (!created) throw new Error("Inserting a question returned no row");
		const [key] = await tx
			.insert(questionKey)
			.values({ questionId: created.id, ...input.key })
			.returning();
		if (!key) throw new Error("Inserting a question key returned no row");
		return { ok: true, question: toTeacherQuestion(created, key) } as const;
	});
}

// The kind may change. Past attempts keep the score they were given.
export async function updateQuestion(actor: UserId, questionId: QuestionId, input: QuestionInput) {
	return db.transaction(async (tx) => {
		const access = await writeQuestion(tx, actor, questionId);
		if (!access.ok) return access;
		const [updated] = await tx
			.update(question)
			.set({ kind: input.kind, prompt: input.prompt, choices: input.choices })
			.where(eq(question.id, questionId))
			.returning();
		const [key] = await tx
			.update(questionKey)
			.set(input.key)
			.where(eq(questionKey.questionId, questionId))
			.returning();
		if (!updated || !key) throw new Error("Updating a locked question returned no row");
		return { ok: true, question: toTeacherQuestion(updated, key) } as const;
	});
}

export async function deleteQuestion(actor: UserId, questionId: QuestionId) {
	return db.transaction(async (tx) => {
		const access = await writeQuestion(tx, actor, questionId);
		if (!access.ok) return access;
		await tx.delete(question).where(eq(question.id, questionId));
		await tx
			.update(question)
			.set({ position: sql`${question.position} - 1` })
			.where(and(eq(question.stepId, access.stepId), gt(question.position, access.position)));
		return OK;
	});
}

export async function reorderQuestions(actor: UserId, stepId: StepId, orderedIds: QuestionId[]) {
	return db.transaction(async (tx) => {
		const access = await writeQuiz(tx, actor, stepId);
		if (!access.ok) return access;
		const current = await tx
			.select({ id: question.id })
			.from(question)
			.where(eq(question.stepId, stepId));
		if (
			!sameIds(
				current.map((q) => q.id),
				orderedIds,
			)
		)
			return fail("ids_mismatch");
		if (orderedIds.length === 0) return OK;
		await tx
			.update(question)
			.set({ position: positionsIn(question.id, orderedIds) })
			.where(eq(question.stepId, stepId));
		return OK;
	});
}

// Every question with its key, for the teacher's editor.
export async function teacherQuiz(actor: UserId, stepId: StepId) {
	const access = await readQuiz(db, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.role !== "teacher") return fail("forbidden");
	if (access.parsed.kind !== "quiz") return fail("not_a_quiz");
	const rows = await questionsWithKeys(db, stepId);
	return {
		ok: true,
		settings: access.parsed.content,
		questions: rows.map(({ question: q, key }) => toTeacherQuestion(q, key)),
	} as const;
}

// Every attempt by each current student of the class, for the teacher. Grouped by student, then in order.
// Someone who left the class drops out here, as they do from classProgress.
export async function quizAttempts(actor: UserId, stepId: StepId) {
	const access = await readQuiz(db, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.role !== "teacher") return fail("forbidden");
	if (access.parsed.kind !== "quiz") return fail("not_a_quiz");
	const attempts = await db
		.select({
			studentId: quizAttempt.studentId,
			username: user.username,
			name: user.name,
			attemptNumber: quizAttempt.attemptNumber,
			answers: quizAttempt.answers,
			score: quizAttempt.score,
			submittedAt: quizAttempt.submittedAt,
		})
		.from(quizAttempt)
		.innerJoin(user, eq(user.id, quizAttempt.studentId))
		.innerJoin(
			classMember,
			and(
				eq(classMember.userId, quizAttempt.studentId),
				eq(classMember.classId, access.classId),
				eq(classMember.role, "student"),
			),
		)
		.where(eq(quizAttempt.stepId, stepId))
		.orderBy(asc(user.username), asc(quizAttempt.attemptNumber));
	return {
		ok: true,
		attempts: attempts.map((a) => Object.assign(a, { answers: StoredAnswers.assert(a.answers) })),
	} as const;
}

// Whether each question was right, keyed by question id, as graded at submit time.
const StoredResults = type("Record<string, boolean>");

const scoresOf = async (conn: Conn, stepId: StepId, studentId: UserId) =>
	(
		await conn
			.select({ score: quizAttempt.score })
			.from(quizAttempt)
			.where(and(eq(quizAttempt.stepId, stepId), eq(quizAttempt.studentId, studentId)))
	).map((a) => a.score);

// One student's own attempts, in order, with their answers and which questions they got right.
// None of it comes from question_key, so it is safe to send before a pass.
async function attemptsOf(conn: Conn, stepId: StepId, studentId: UserId) {
	const rows = await conn
		.select({
			attemptNumber: quizAttempt.attemptNumber,
			score: quizAttempt.score,
			submittedAt: quizAttempt.submittedAt,
			answers: quizAttempt.answers,
			results: quizAttempt.results,
		})
		.from(quizAttempt)
		.where(and(eq(quizAttempt.stepId, stepId), eq(quizAttempt.studentId, studentId)))
		.orderBy(asc(quizAttempt.attemptNumber));
	return rows.map((a) =>
		Object.assign(a, {
			answers: StoredAnswers.assert(a.answers),
			results: StoredResults.assert(a.results),
		}),
	);
}

// The quiz as the acting student sees it: questions without keys, their own attempts with their
// answers and per-question results, and the solutions only after they pass. Teachers use teacherQuiz instead.
export async function getQuiz(actor: UserId, stepId: StepId) {
	const access = await readQuiz(db, actor, stepId);
	if (!access) return NOT_FOUND;
	if (access.role !== "student") return fail("forbidden");
	if (access.parsed.kind !== "quiz") return fail("not_a_quiz");
	const [rows, attempts] = await Promise.all([
		questionsOf(db, stepId),
		attemptsOf(db, stepId, actor),
	]);
	const progress = quizProgress(
		access.parsed.content,
		attempts.map((a) => a.score),
	);
	return {
		ok: true,
		settings: access.parsed.content,
		questions: rows.map(toQuestion),
		attempts,
		passed: progress.passed,
		attemptsLeft: progress.attemptsLeft,
		reveal: progress.passed ? await revealFor(db, stepId) : null,
	} as const;
}

// Grades one attempt and stores it. Unanswered questions count as wrong. While attempts remain, the
// result says only which questions were right; the reveal comes only with a pass.
// Runs under the class lock, so two submits at once can't both take the same attempt number or go
// past maxAttempts, and a teacher can't change the questions halfway through grading. The cost is
// that submits in one class run one at a time, which is fine at this app's size.
export async function submitAttempt(actor: UserId, stepId: StepId, answers: AnswersInput) {
	return db.transaction(async (tx) => {
		const [found] = await tx
			.select({ classId: moduleTable.classId })
			.from(step)
			.innerJoin(moduleTable, eq(moduleTable.id, step.moduleId))
			.where(eq(step.id, stepId));
		if (!found || !(await lockClass(tx, found.classId))) return NOT_FOUND;
		// Read again under the lock: membership, the step, or the module may have changed while we waited.
		const access = await readQuiz(tx, actor, stepId);
		if (!access) return NOT_FOUND;
		if (access.role !== "student") return fail("forbidden");
		if (access.parsed.kind !== "quiz") return fail("not_a_quiz");
		const settings = access.parsed.content;

		const scores = await scoresOf(tx, stepId, actor);
		const before = quizProgress(settings, scores);
		if (before.passed) return fail("already_passed");
		if (before.attemptsLeft === 0) return fail("no_attempts_left");

		const rows = await questionsWithKeys(tx, stepId);
		if (rows.length === 0) return fail("no_questions");
		// Postgres returns uuids in lowercase, and an uppercase uuid is still valid input. Ids that
		// aren't in this quiz, or two ids for the same question, refuse the attempt.
		const known = new Set<string>(rows.map((r) => r.question.id));
		const given = new Map<string, unknown>();
		for (const [id, value] of Object.entries(answers)) {
			const lower = id.toLowerCase();
			if (!known.has(lower) || given.has(lower)) {
				return { ...fail("invalid_answer"), questionId: id };
			}
			given.set(lower, value);
		}

		const stored: Record<string, unknown> = {};
		const results: { questionId: QuestionId; correct: boolean }[] = [];
		for (const { question: q, key } of rows) {
			if (!given.has(q.id)) {
				results.push({ questionId: q.id, correct: false });
				continue;
			}
			const graded = QUESTION_KINDS[q.kind].grade(key.correct, given.get(q.id));
			if (!graded) return { ...fail("invalid_answer"), questionId: q.id };
			stored[q.id] = graded.answer;
			results.push({ questionId: q.id, correct: graded.correct });
		}
		const score = Math.floor((results.filter((r) => r.correct).length * 100) / rows.length);
		const attemptNumber = scores.length + 1;
		await tx.insert(quizAttempt).values({
			stepId,
			studentId: actor,
			attemptNumber,
			answers: stored,
			results: Object.fromEntries(results.map((r) => [r.questionId, r.correct])),
			score,
		});

		const after = quizProgress(settings, [...scores, score]);
		return {
			ok: true,
			attempt: { attemptNumber, score },
			results,
			passed: after.passed,
			attemptsLeft: after.attemptsLeft,
			reveal: after.passed ? await revealFor(tx, stepId) : null,
		} as const;
	});
}
