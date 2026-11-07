// Owns: the server functions the assignment and reflection screens call, which find the signed-in user and parse input, and the queries that cache them in the browser. Not here: the submission rules (src/server/submissions.ts) or file upload and download, which are HTTP routes (src/routes/api/files/).

import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { ClassId, StepId, SubmissionFileId, SubmissionId } from "#/db/ids";
import { requireActor } from "#/server/class-fns";
import { retry } from "#/server/module-fns";
import { deleteFile } from "#/server/submission-files";
import {
	DraftInput,
	GradeInput,
	ReturnInput,
	getMySubmission,
	grade,
	gradingQueue,
	listSubmissions,
	returnSubmission,
	saveDraft,
	submit,
	waitingCount,
} from "#/server/submissions";

const ForStep = type({ stepId: StepId });
const ForSubmission = type({ submissionId: SubmissionId });

export const getMySubmissionFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => getMySubmission(await requireActor(), data.stepId));

export const saveDraftFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge(DraftInput))
	.handler(async ({ data: { stepId, ...input } }) =>
		saveDraft(await requireActor(), stepId, input),
	);

export const submitFn = createServerFn({ method: "POST" })
	.validator(ForStep)
	.handler(async ({ data }) => submit(await requireActor(), data.stepId));

export const deleteFileFn = createServerFn({ method: "POST" })
	.validator(type({ fileId: SubmissionFileId }))
	.handler(async ({ data }) => deleteFile(await requireActor(), data.fileId));

export const listSubmissionsFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => listSubmissions(await requireActor(), data.stepId));

// Return and grade fields sit under their own key, because both inputs carry a morph (trimming)
// and ArkType's merge only takes plain objects.
export const returnSubmissionFn = createServerFn({ method: "POST" })
	.validator(ForSubmission.merge({ input: ReturnInput }))
	.handler(async ({ data }) =>
		returnSubmission(await requireActor(), data.submissionId, data.input),
	);

export const gradeFn = createServerFn({ method: "POST" })
	.validator(ForSubmission.merge({ grade: GradeInput }))
	.handler(async ({ data }) => grade(await requireActor(), data.submissionId, data.grade));

const InClass = type({ classId: ClassId });

export const gradingQueueFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => gradingQueue(await requireActor(), data.classId));

export const waitingCountFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => waitingCount(await requireActor(), data.classId));

// Keyed by user like the other queries. Invalidate ["submission"] and ["grading"] after a move.
export const mySubmissionQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["submission", userId, stepId],
		retry,
		queryFn: async () => {
			const result = await getMySubmissionFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result;
		},
	});
export type MySubmission = Extract<Awaited<ReturnType<typeof getMySubmission>>, { ok: true }>;

// Teachers only. Both sit under ["grading"], so one invalidation refreshes the queue and the count.
export const waitingCountQuery = (userId: string, classId: ClassId) =>
	queryOptions({
		queryKey: ["grading", userId, classId, "count"],
		retry,
		queryFn: async () => {
			const result = await waitingCountFn({ data: { classId } });
			if (!result.ok) throw notFound();
			return result.waiting;
		},
	});

export const gradingQueueQuery = (userId: string, classId: ClassId) =>
	queryOptions({
		queryKey: ["grading", userId, classId],
		retry,
		queryFn: async () => {
			const result = await gradingQueueFn({ data: { classId } });
			if (!result.ok) throw notFound();
			return result;
		},
	});
// Every student of the class with their work on one step, for the step editor's Kiriman tab.
// Under ["grading"] too, so a grade or return anywhere refreshes it.
export const stepSubmissionsQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["grading", userId, "step", stepId],
		retry,
		queryFn: async () => {
			const result = await listSubmissionsFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result.students;
		},
	});

export type GradingQueue = Extract<Awaited<ReturnType<typeof gradingQueue>>, { ok: true }>;
