// Owns: the server functions the assignment and reflection screens call, which find the signed-in user and parse input. Not here: the submission rules (src/server/submissions.ts) or file upload and download, which are HTTP routes (src/routes/api/files/).

import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { StepId, SubmissionFileId, SubmissionId } from "#/db/ids";
import { requireActor } from "#/server/class-fns";
import { deleteFile } from "#/server/submission-files";
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
