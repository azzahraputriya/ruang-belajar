// Owns: the step kind registry, meaning each kind's content shape, whether the student marks it finished, and how its status is computed. Not here: the tables (src/db/content-schema.ts) or reading and writing steps (src/server/modules.ts).

import { type } from "arktype";
import type { StepKind, VisitEvent } from "#/db/content-schema";

// Every status in docs/data-model.md. "graded" arrives with assignments.
export type StepStatus = "not_started" | "in_progress" | "needs_help" | "done" | "graded";

// What one student has done on one step. Later kinds add their work here, e.g. submissions.
export type StepWork = {
	visits: ReadonlySet<VisitEvent>;
	// The score of each submitted quiz attempt, in percent. Empty for other kinds.
	scores: readonly number[];
};

type StepKindSpec = {
	content: (data: unknown) => unknown;
	// True when the student says "I'm done" themselves, so a "finished" visit is allowed.
	finishedByStudent: boolean;
	// `never` lets each kind name its own parsed content. stepStatus pairs them up.
	status: (work: StepWork, content: never) => StepStatus;
};

// A "finished" with no "opened" before it still counts as done. Finishing is the stronger signal,
// and a lost "opened" request shouldn't leave a student stuck.
function statusFromVisits({ visits }: StepWork): StepStatus {
	if (visits.has("finished")) return "done";
	if (visits.has("opened")) return "in_progress";
	return "not_started";
}

export const Markdown = type("string <= 100000");
const HttpsUrl = type("string.url").narrow(
	(url, ctx) => new URL(url).protocol === "https:" || ctx.mustBe("an https URL"),
);

const QuizContent = type({
	"+": "delete",
	maxAttempts: ["1 <= number.integer <= 10", "=", 3],
	passScore: ["0 <= number.integer <= 100", "=", 70],
});
type QuizContent = typeof QuizContent.infer;

// Where one student stands on a quiz. The best attempt counts, and a pass closes the quiz:
// no more attempts after it, because a pass also reveals the solutions.
// Both settings are read live, so a teacher raising maxAttempts reopens a quiz that ran out,
// even if its solutions were already shown.
export function quizProgress({ maxAttempts, passScore }: QuizContent, scores: readonly number[]) {
	const passed = scores.some((score) => score >= passScore);
	const attemptsLeft = passed ? 0 : Math.max(0, maxAttempts - scores.length);
	return { passed, attemptsLeft, closed: attemptsLeft === 0 };
}

function quizStatus(work: StepWork, content: QuizContent): StepStatus {
	const { passed, closed } = quizProgress(content, work.scores);
	if (passed) return "done";
	if (closed) return "needs_help";
	if (work.scores.length > 0 || work.visits.size > 0) return "in_progress";
	return "not_started";
}

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
	// Questions live in their own tables (src/db/quiz-schema.ts), not in content.
	quiz: {
		content: QuizContent,
		finishedByStudent: false,
		status: quizStatus,
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

export function stepStatus({ kind, content }: StepContent, work: StepWork): StepStatus {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Same as parseStepContent: `content` belongs to `kind`, which TypeScript can't link across the union.
	const status = STEP_KINDS[kind].status as (w: StepWork, c: typeof content) => StepStatus;
	return status(work, content);
}
