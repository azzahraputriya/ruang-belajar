// Owns: the step kind registry, meaning each kind's content shape, whether the student marks it finished, and how its status is computed. Not here: the tables (src/db/content-schema.ts) or reading and writing steps (src/server/modules.ts).

import { type } from "arktype";
import type { StepKind, VisitEvent } from "#/db/content-schema";

// Every status in docs/data-model.md. Phase 4 kinds only produce the first three.
export type StepStatus = "not_started" | "in_progress" | "needs_help" | "done" | "graded";

// What one student has done on one step. Later kinds add their work here, e.g. quiz attempts.
export type StepWork = { visits: ReadonlySet<VisitEvent> };

type StepKindSpec = {
	content: (data: unknown) => unknown;
	// True when the student says "I'm done" themselves, so a "finished" visit is allowed.
	finishedByStudent: boolean;
	status: (work: StepWork) => StepStatus;
};

// A "finished" with no "opened" before it still counts as done. Finishing is the stronger signal,
// and a lost "opened" request shouldn't leave a student stuck.
function statusFromVisits({ visits }: StepWork): StepStatus {
	if (visits.has("finished")) return "done";
	if (visits.has("opened")) return "in_progress";
	return "not_started";
}

const Markdown = type("string <= 100000");
const HttpsUrl = type("string.url").narrow(
	(url, ctx) => new URL(url).protocol === "https:" || ctx.mustBe("an https URL"),
);

// "+": "delete" drops keys the shape doesn't name, so nothing unchecked reaches the jsonb column.
export const STEP_KINDS = {
	// Images are markdown image links for now. Uploads come with assignments.
	reading: {
		content: type({ "+": "delete", body: Markdown }),
		finishedByStudent: true,
		status: statusFromVisits,
	},
	embed: {
		content: type({ "+": "delete", url: HttpsUrl, instructions: Markdown }),
		finishedByStudent: true,
		status: statusFromVisits,
	},
} as const satisfies Record<StepKind, StepKindSpec>;

// `kind` decides the shape of `content`.
export type StepContent = {
	[K in StepKind]: { kind: K; content: (typeof STEP_KINDS)[K]["content"]["infer"] };
}[StepKind];

export function parseStepContent(kind: StepKind, raw: unknown) {
	const parse: StepKindSpec["content"] = STEP_KINDS[kind].content;
	const content = parse(raw);
	if (content instanceof type.errors) return content;
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TypeScript can't link `kind` to the registry entry it picked, so it can't see this pair matches. Avoiding it needs one hand-written branch per kind.
	return { kind, content } as StepContent;
}

export const stepStatus = (kind: StepKind, work: StepWork) => STEP_KINDS[kind].status(work);
