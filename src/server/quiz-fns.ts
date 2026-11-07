// Owns: the server functions the quiz screens call, which find the signed-in user and parse input, and the queries that cache them in the browser. Not here: the quiz rules and answer keys (src/server/quizzes.ts).

import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { QuestionId, StepId } from "#/db/ids";
import { requireActor } from "#/server/class-fns";
import { retry } from "#/server/module-fns";
import {
	AnswersInput,
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

const ForStep = type({ stepId: StepId });
const ForQuestion = type({ questionId: QuestionId });

export const getQuizFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => getQuiz(await requireActor(), data.stepId));

export const submitAttemptFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge({ answers: AnswersInput }))
	.handler(async ({ data }) => submitAttempt(await requireActor(), data.stepId, data.answers));

export const teacherQuizFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => teacherQuiz(await requireActor(), data.stepId));

export const quizAttemptsFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => quizAttempts(await requireActor(), data.stepId));

// Question fields sit under `question`, because QuestionInput is a morph and ArkType's merge only takes plain objects.
export const createQuestionFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge({ question: QuestionInput }))
	.handler(async ({ data }) => createQuestion(await requireActor(), data.stepId, data.question));

export const updateQuestionFn = createServerFn({ method: "POST" })
	.validator(ForQuestion.merge({ question: QuestionInput }))
	.handler(async ({ data }) =>
		updateQuestion(await requireActor(), data.questionId, data.question),
	);

export const deleteQuestionFn = createServerFn({ method: "POST" })
	.validator(ForQuestion)
	.handler(async ({ data }) => deleteQuestion(await requireActor(), data.questionId));

export const reorderQuestionsFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge({ orderedIds: QuestionId.array() }))
	.handler(async ({ data }) =>
		reorderQuestions(await requireActor(), data.stepId, data.orderedIds),
	);

// Students only. Holds no keys until the student passes.
export const quizQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["quiz", userId, stepId],
		retry,
		queryFn: async () => {
			const result = await getQuizFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result;
		},
	});
export type StudentQuiz = Extract<Awaited<ReturnType<typeof getQuiz>>, { ok: true }>;
export type QuizQuestion = StudentQuiz["questions"][number];
export type QuizAttempt = StudentQuiz["attempts"][number];

// Teachers only. Every question with its key.
export const teacherQuizQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["teacher-quiz", userId, stepId],
		retry,
		queryFn: async () => {
			const result = await teacherQuizFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result.questions;
		},
	});
export type TeacherQuestion = Extract<
	Awaited<ReturnType<typeof teacherQuiz>>,
	{ ok: true }
>["questions"][number];
