// Owns: the step kind registry, meaning each kind's content shape, whether the student marks it finished, and how its status is computed. Not here: the tables (src/db/content-schema.ts) or reading and writing steps (src/server/modules.ts).

import { type } from "arktype";
import type { StepKind, VisitEvent } from "#/db/content-schema";
import type { SubmissionStatus } from "#/db/submission-schema";

// Every status in docs/data-model.md.
export type StepStatus = "not_started" | "in_progress" | "needs_help" | "done" | "graded";

// What one student has done on one step.
export type StepWork = {
	visits: ReadonlySet<VisitEvent>;
	// The score of each submitted quiz attempt, in percent. Empty for other kinds.
	scores: readonly number[];
	// The status of their assignment or reflection submission. Null when there is none.
	submission: SubmissionStatus | null;
	// Their discussion posts that count: thread starters, and replies to someone else's thread.
	// Deleted ones don't count. Zero for other kinds.
	posts: number;
	replies: number;
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
// Both settings are read live, so a teacher raising maxAttempts reopens a quiz that ran out.
// That is safe because running out never reveals the solutions.
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

// A grade's points are keyed by criterion id, so ids are unique within a rubric.
const Criterion = type({
	"+": "delete",
	id: "1 <= string <= 64",
	title: "1 <= string <= 200",
	"description?": Markdown,
	maxPoints: "1 <= number.integer <= 100",
});
const Rubric = Criterion.array()
	.atLeastLength(1)
	.atMostLength(20)
	.narrow(
		(criteria, ctx) =>
			new Set(criteria.map((c) => c.id)).size === criteria.length || ctx.mustBe("unique ids"),
	);
export type Rubric = typeof Rubric.infer;

const AssignmentContent = type({
	"+": "delete",
	prompt: Markdown,
	accepts: type({ "+": "delete", text: "boolean", files: "boolean" }).narrow(
		(a, ctx) => a.text || a.files || ctx.mustBe("accepting text, files, or both"),
	),
	"rubric?": Rubric,
});

const STATUS_OF_SUBMISSION = {
	draft: "in_progress",
	submitted: "done",
	returned: "needs_help",
	graded: "graded",
} as const satisfies Record<SubmissionStatus, StepStatus>;

// Required counts are read live, like quiz settings: a teacher raising them moves a done student
// back to in progress. At least one is above zero, so done always means the student wrote something.
const DiscussionContent = type({
	"+": "delete",
	prompt: Markdown,
	requiredPosts: ["0 <= number.integer <= 10", "=", 1],
	requiredReplies: ["0 <= number.integer <= 10", "=", 0],
}).narrow(
	(c, ctx) =>
		c.requiredPosts > 0 ||
		c.requiredReplies > 0 ||
		ctx.mustBe("requiring a post, a reply, or both"),
);
type DiscussionContent = typeof DiscussionContent.infer;

// Exported for the teacher's Diskusi tab (src/server/discussions.ts), so it shows the same status.
export function discussionStatus(work: StepWork, content: DiscussionContent): StepStatus {
	const { posts, replies, visits } = work;
	if (posts >= content.requiredPosts && replies >= content.requiredReplies) return "done";
	if (posts > 0 || replies > 0 || visits.size > 0) return "in_progress";
	return "not_started";
}

// Shared by assignments and reflections. A reflection is never graded, so it never reaches "graded".
function statusFromSubmission({ submission, visits }: StepWork): StepStatus {
	if (submission) return STATUS_OF_SUBMISSION[submission];
	return visits.size > 0 ? "in_progress" : "not_started";
}

// "+": "delete" drops keys the shape doesn't name, so nothing unchecked reaches the jsonb column.
export const STEP_KINDS = {
	// Images are markdown image links.
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
	// The teacher grades it: with the rubric when there is one, otherwise a 0 to 100 score.
	assignment: {
		content: AssignmentContent,
		finishedByStudent: false,
		status: statusFromSubmission,
	},
	// Text only and never scored. A teacher can still return it with a comment.
	reflection: {
		content: type({ "+": "delete", prompt: Markdown }),
		finishedByStudent: false,
		status: statusFromSubmission,
	},
	// Posts live in their own table (src/db/discussion-schema.ts), not in content.
	discussion: {
		content: DiscussionContent,
		finishedByStudent: false,
		status: discussionStatus,
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
