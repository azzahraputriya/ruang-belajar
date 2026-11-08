// Owns: the step editor's Diskusi tab for a discussion: every student with their counts beside either all threads or one student's posts in their threads, and the tab's post count. Not here: one thread's posts and actions (src/components/discussion-thread.tsx) or the student's page (src/components/discussion-sheet.tsx).

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NewThreadBox, type Thread, ThreadView } from "#/components/discussion-thread";
import { PaneMessage } from "#/components/pane-message";
import { StatusIcon } from "#/components/syllabus";
import type { StepId } from "#/db/ids";
import { type Posts, discussionProgressQuery, postsQuery } from "#/server/discussion-fns";
import type { StepStatus } from "#/server/step-kinds";

type Required = { requiredPosts: number; requiredReplies: number };
type Counts = { posts: number; replies: number };

// Matches the server's status rule, minus visits, which the tab doesn't load.
function statusOf(c: Counts, req: Required): StepStatus {
	if (c.posts >= req.requiredPosts && c.replies >= req.requiredReplies) return "done";
	return c.posts + c.replies > 0 ? "in_progress" : "not_started";
}

// "Diskusi 9": posts that aren't deleted. A teacher is never held back by answer-first.
export function livePostCount(posts: Posts | undefined) {
	if (!posts || posts.locked) return 0;
	return posts.threads.reduce(
		(n, t) => n + (t.deleted ? 0 : 1) + t.replies.filter((r) => !r.deleted).length,
		0,
	);
}

const wroteIn = (t: Thread, userId: string) =>
	(!t.deleted && t.authorId === userId) ||
	t.replies.some((r) => !r.deleted && r.authorId === userId);

const ROW =
	"mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-ring hover:bg-muted focus-visible:outline-2";
const ACTIVE = "bg-primary/10 font-medium text-primary hover:bg-primary/10";

export function DiscussionTab({
	userId,
	stepId,
	required,
}: {
	userId: string;
	stepId: StepId;
	// The saved requirement, not the one being edited: status is counted against what is saved.
	required: Required;
}) {
	const posts = useQuery(postsQuery(userId, stepId));
	const students = useQuery(discussionProgressQuery(userId, stepId));
	// "semua" shows every thread. A student's id shows only the threads they wrote in.
	const [picked, setPicked] = useState("semua");

	if (posts.isError || students.isError) {
		return <PaneMessage title="Diskusi tidak bisa dimuat. Coba lagi." />;
	}
	if (!posts.data || !students.data) return <PaneMessage title="Memuat diskusi…" />;
	if (posts.data.locked) return null;

	const threads = posts.data.threads;
	const list = students.data;
	const done = list.filter((s) => statusOf(s, required) === "done").length;
	// A student who left the class drops out of the list, so fall back to all threads.
	const open = list.find((s) => s.userId === picked);

	return (
		<div className="mt-3 grid border-t md:grid-cols-[16rem_minmax(0,1fr)]">
			<nav aria-label="Siswa" className="border-b py-2 md:border-r md:border-b-0">
				<button
					type="button"
					aria-current={open ? undefined : "true"}
					onClick={() => setPicked("semua")}
					className={`${ROW} ${open ? "" : ACTIVE}`}
				>
					<span className="flex-1">Semua tanggapan</span>
					<span className="text-xs font-normal text-muted-foreground tabular-nums">
						{livePostCount(posts.data)}
					</span>
				</button>
				<p className="px-4 pt-3 pb-1.5 text-xs text-muted-foreground">
					{done} dari {list.length} selesai · tanggapan·balasan
				</p>
				<ol>
					{list.map((s) => {
						const active = s.userId === open?.userId;
						return (
							<li key={s.userId}>
								<button
									type="button"
									aria-current={active ? "true" : undefined}
									onClick={() => setPicked(s.userId)}
									className={`${ROW} ${active ? ACTIVE : ""}`}
								>
									<StatusIcon status={statusOf(s, required)} className="size-3.5" />
									<span className="min-w-0 flex-1 truncate">{s.name}</span>
									<span className="text-xs font-normal text-muted-foreground tabular-nums">
										{s.posts}·{s.replies}
									</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>
			<div className="min-w-0 px-4 py-4 md:px-6">
				{open ? (
					<>
						<h2 className="font-medium">{open.name}</h2>
						<p className="text-sm text-muted-foreground">
							Tanggapan {open.posts}/{required.requiredPosts} · balasan ke teman {open.replies}/
							{required.requiredReplies}
						</p>
						<ThreadList
							threads={threads.filter((t) => wroteIn(t, open.userId))}
							focus={open.userId}
							empty="Belum menulis apa pun."
						/>
					</>
				) : (
					<>
						<NewThreadBox
							stepId={stepId}
							label="Tanggapan baru"
							placeholder="Tulis tanggapan…"
							minHeight="min-h-20"
						/>
						<ThreadList threads={threads} empty="Belum ada tanggapan." />
					</>
				)}
			</div>
		</div>
	);
}

function ThreadList({
	threads,
	focus,
	empty,
}: {
	threads: readonly Thread[];
	focus?: string;
	empty: string;
}) {
	if (threads.length === 0) return <p className="mt-4 text-sm text-muted-foreground">{empty}</p>;
	return (
		<ul className="mt-4">
			{threads.map((t) => (
				<li key={t.id} className="border-t py-5">
					<ThreadView thread={t} teacher focus={focus} />
				</li>
			))}
		</ul>
	);
}
