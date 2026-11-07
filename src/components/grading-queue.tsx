// Owns: the teacher's class-wide grading queue (work waiting per step, who hasn't handed in, and which piece of work is open). Not here: the route (src/routes/_app/kelas/$classId/nilai.tsx), the pane that shows and grades one piece of work (src/components/submission-pane.tsx), or grading rules (src/server/submissions.ts).

import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { PaneMessage } from "#/components/pane-message";
import { SubmissionPane, lastSubmit } from "#/components/submission-pane";
import { Late } from "#/components/submission-parts";
import type { ClassId } from "#/db/ids";
import { formatDay, formatDayTime } from "#/lib/wib";
import { type GradingQueue as Queue, gradingQueueQuery } from "#/server/submission-fns";

type QueueStep = Queue["steps"][number];

// "Eko (draf), Fajar, Yoga", or a count once the names stop fitting on a line.
function notInText(step: QueueStep) {
	const due = step.dueAt ? ` · tenggat ${formatDay(step.dueAt)}` : "";
	if (step.notIn.length === 0) return "";
	if (step.notIn.length > 3) return `${step.notIn.length} siswa${due}`;
	return step.notIn.map((s) => `${s.name}${s.draft ? " (draf)" : ""}`).join(", ") + due;
}

export function GradingQueue({
	userId,
	classId,
	selected,
}: {
	userId: string;
	classId: ClassId;
	selected: string | undefined;
}) {
	const { data } = useSuspenseQuery(gradingQueueQuery(userId, classId));
	const groups = data.steps.filter((s) => s.waiting.length > 0);
	const all = groups.flatMap((step) => step.waiting.map((item) => ({ step, item })));
	const navigate = useNavigate();
	const index = all.findIndex((x) => x.item.submission.id === selected);
	const open = all[index] ?? all[0];
	// Graded or returned work leaves the queue, so the one after it opens next (or the one before, at
	// the end), and the teacher keeps going down the list instead of jumping back to the top.
	const openNext = () => {
		const at = all.indexOf(open);
		const next = all[at + 1] ?? all[at - 1];
		return navigate({
			to: "/kelas/$classId/nilai",
			params: { classId },
			search: next ? { kiriman: next.item.submission.id } : {},
			replace: true,
		});
	};

	if (!open) return <PaneMessage title="Tidak ada yang perlu dinilai." />;

	return (
		<div className="grid min-h-full md:grid-cols-[17rem_minmax(0,1fr)]">
			<nav aria-label="Perlu dinilai" className="border-b py-3 md:border-r md:border-b-0">
				{groups.map((step) => (
					<section key={step.id} aria-label={step.title} className="mb-4">
						<h2 className="mx-2 flex px-2 py-1.5 text-xs font-medium text-muted-foreground">
							<span className="flex-1 truncate">{step.title}</span>
							<span className="tabular-nums">{step.waiting.length}</span>
						</h2>
						<ol>
							{step.waiting.map(({ submission, name }) => {
								const active = submission.id === open.item.submission.id;
								const at = lastSubmit(submission);
								return (
									<li key={submission.id}>
										<Link
											to="/kelas/$classId/nilai"
											params={{ classId }}
											search={{ kiriman: submission.id }}
											aria-current={active ? "page" : undefined}
											className={`mx-2 grid rounded-md px-2 py-1.5 text-sm hover:bg-muted ${active ? "bg-primary/10 hover:bg-primary/10" : ""}`}
										>
											<span className={`truncate ${active ? "font-medium text-primary" : ""}`}>
												{name}
											</span>
											<span className="text-xs text-muted-foreground">
												{at ? formatDayTime(at) : null}
												{submission.late ? (
													<>
														{" · "}
														<Late />
													</>
												) : null}
											</span>
										</Link>
									</li>
								);
							})}
						</ol>
						{step.notIn.length > 0 ? (
							<p className="mx-4 mt-1 text-xs text-muted-foreground">Belum: {notInText(step)}</p>
						) : null}
					</section>
				))}
			</nav>
			<SubmissionPane
				key={open.item.submission.id}
				target={{
					stepTitle: open.step.title,
					dueAt: open.step.dueAt,
					rubric: open.step.rubric,
					scored: true,
					name: open.item.name,
					submission: open.item.submission,
				}}
				onDone={openNext}
			/>
		</div>
	);
}
