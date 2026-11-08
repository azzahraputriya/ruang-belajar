// Owns: the student's discussion page: the prompt, their checklist, writing their answer first, then their own threads pinned above classmates' answers. Not here: one thread's posts and actions (src/components/discussion-thread.tsx), the teacher's Diskusi tab (src/components/discussion-tab.tsx), or the answer-first rule itself (src/server/discussions.ts).

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Lock } from "lucide-react";
import { NewThreadBox, type Thread, ThreadView } from "#/components/discussion-thread";
import { Markdown } from "#/components/step-kinds-ui";
import { StatusIcon } from "#/components/syllabus";
import { Button } from "#/components/ui/button";
import type { ClassId, StepId } from "#/db/ids";
import { postsQuery } from "#/server/discussion-fns";
import type { Step } from "#/server/modules";
import type { StepStatus } from "#/server/step-kinds";

type DiscussionStep = Extract<Step, { kind: "discussion" }>;

const progressOf = (have: number, need: number): StepStatus => {
	if (have >= need) return "done";
	return have > 0 ? "in_progress" : "not_started";
};

// One row per requirement the teacher set. The counts come from the server, by the same rule as status.
function Checklist({
	content,
	counts,
}: {
	content: DiscussionStep["content"];
	counts: { posts: number; replies: number };
}) {
	const { requiredPosts, requiredReplies } = content;
	return (
		<ul className="mt-4 grid gap-1 text-sm">
			{requiredPosts > 0 ? (
				<li className="flex items-center gap-2">
					<StatusIcon status={progressOf(counts.posts, requiredPosts)} className="size-3.5" />
					{requiredPosts === 1 ? "Tulis tanggapanmu" : `Tulis ${requiredPosts} tanggapan`}
					{requiredPosts > 1 ? (
						<span className="text-muted-foreground tabular-nums">
							{Math.min(counts.posts, requiredPosts)}/{requiredPosts}
						</span>
					) : null}
				</li>
			) : null}
			{requiredReplies > 0 ? (
				<li className="flex items-center gap-2">
					<StatusIcon status={progressOf(counts.replies, requiredReplies)} className="size-3.5" />
					Balas {requiredReplies} teman
					<span className="text-muted-foreground tabular-nums">
						{Math.min(counts.replies, requiredReplies)}/{requiredReplies}
					</span>
				</li>
			) : null}
		</ul>
	);
}

export function DiscussionSheet({
	userId,
	classId,
	step,
	nextStepId,
}: {
	userId: string;
	classId: ClassId;
	step: DiscussionStep;
	nextStepId: StepId | undefined;
}) {
	const { data } = useSuspenseQuery(postsQuery(userId, step.id));
	const { content } = step;
	const { counts } = data;
	const done = counts.posts >= content.requiredPosts && counts.replies >= content.requiredReplies;
	const writeMore = counts.posts < content.requiredPosts;

	return (
		<>
			<Markdown>{content.prompt}</Markdown>
			<Checklist content={content} counts={counts} />

			{data.locked ? (
				<>
					<section aria-labelledby="tanggapanmu" className="mt-8 grid gap-2 border-t pt-6">
						<h2 id="tanggapanmu" className="text-sm font-medium">
							Tanggapanmu
						</h2>
						<NewThreadBox
							stepId={step.id}
							label="Tanggapanmu"
							placeholder="Jawab dengan kata-katamu sendiri…"
							minHeight="min-h-32"
						/>
					</section>
					<p className="mt-8 flex items-center gap-2 border-t pt-6 text-sm text-muted-foreground">
						<Lock aria-hidden="true" className="size-4 shrink-0" />
						{data.waiting > 0
							? `${data.waiting} tanggapan sudah masuk. Terbuka setelah kamu mengirim.`
							: "Tanggapan teman terbuka setelah kamu mengirim."}
					</p>
				</>
			) : (
				<Threads stepId={step.id} threads={data.threads} writeMore={writeMore} />
			)}

			{done && nextStepId ? (
				<div className="mt-10 flex justify-end border-t pt-4">
					<Button variant="outline" asChild>
						<Link to="/kelas/$classId/langkah/$stepId" params={{ classId, stepId: nextStepId }}>
							Lanjut <ArrowRight />
						</Link>
					</Button>
				</div>
			) : null}
		</>
	);
}

// Your own threads pinned on top, then everyone else's, oldest first.
function Threads({
	stepId,
	threads,
	writeMore,
}: {
	stepId: StepId;
	threads: readonly Thread[];
	writeMore: boolean;
}) {
	const mine = threads.filter((t) => !t.deleted && t.mine);
	const others = threads.filter((t) => t.deleted || !t.mine);
	return (
		<>
			{mine.length > 0 || writeMore ? (
				<section
					aria-labelledby="tanggapanmu"
					className="mt-8 grid gap-5 rounded-lg bg-muted/50 p-4"
				>
					<h2
						id="tanggapanmu"
						className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
					>
						Tanggapanmu
					</h2>
					{mine.map((t) => (
						<ThreadView key={t.id} thread={t} teacher={false} />
					))}
					{writeMore ? (
						<NewThreadBox
							stepId={stepId}
							label="Tanggapan lain"
							placeholder="Tulis tanggapan lain…"
						/>
					) : null}
				</section>
			) : null}
			<section aria-labelledby="jawaban-teman" className="mt-8">
				<h2 id="jawaban-teman" className="mb-1 text-sm font-medium">
					Jawaban teman <span className="font-normal text-muted-foreground">· {others.length}</span>
				</h2>
				{others.length === 0 ? (
					<p className="border-t py-5 text-sm text-muted-foreground">Belum ada yang lain.</p>
				) : (
					<ul>
						{others.map((t) => (
							<li key={t.id} className="border-t py-5">
								<ThreadView thread={t} teacher={false} showReplied />
							</li>
						))}
					</ul>
				)}
			</section>
		</>
	);
}
