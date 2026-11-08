// Owns: the step editor's Kiriman tab for an assignment or reflection: every student with where their work stands, and the open one beside the list. Not here: the pane that shows and grades one student's work (src/components/submission-pane.tsx) or the class-wide queue (src/components/grading-queue.tsx).

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PaneMessage } from "#/components/pane-message";
import { SubmissionPane } from "#/components/submission-pane";
import { Late } from "#/components/submission-parts";
import type { StepId } from "#/db/ids";
import type { Rubric } from "#/server/step-kinds";
import { stepSubmissionsQuery } from "#/server/submission-fns";
import type { SubmissionView } from "#/server/submissions";

type Row = { submission: SubmissionView | null };

// What each student's row says under their name. A reflection is never graded, so handed in is done.
function rowNote({ submission }: Row, scored: boolean) {
	if (!submission) return "Belum mulai";
	if (submission.status === "graded") return `Dinilai ${submission.score ?? ""}`.trim();
	if (submission.status === "submitted") return scored ? "Perlu dinilai" : "Dikumpulkan";
	if (submission.status === "returned") return "Dikembalikan";
	return "Draf";
}

const notIn = ({ submission }: Row) => !submission || submission.status === "draft";

// "Kiriman 3": the work waiting for a grade. Never counts reflections: nothing would clear them.
export function waitingOn(rows: readonly Row[] | undefined, scored: boolean) {
	if (!scored) return 0;
	return rows?.filter((r) => r.submission?.status === "submitted").length ?? 0;
}

export function SubmissionsTab({
	userId,
	stepId,
	stepTitle,
	dueAt,
	rubric,
	scored,
}: {
	userId: string;
	stepId: StepId;
	stepTitle: string;
	dueAt: Date | null;
	rubric: Rubric | undefined;
	scored: boolean;
}) {
	const { data: students, isError } = useQuery(stepSubmissionsQuery(userId, stepId));
	const [picked, setPicked] = useState<string | undefined>();
	// The first piece of handed-in work (to grade, or for a reflection to read), else the first student.
	const first = (students?.find((s) => s.submission?.status === "submitted") ?? students?.[0])
		?.userId;
	// Locked in once, during render (React's pattern for state that follows props), so a refetch
	// that brings in new work can't switch students mid-grade.
	if (picked === undefined && first !== undefined) setPicked(first);

	if (isError) return <PaneMessage title="Kiriman tidak bisa dimuat. Coba lagi." />;
	if (!students) return <PaneMessage title="Memuat kiriman…" />;
	if (students.length === 0) return <PaneMessage title="Kelas ini belum punya siswa." />;

	// A student who left the class drops out of the list, so fall back to the first.
	const open = students.find((s) => s.userId === picked) ?? students[0];
	if (!open) return null;
	const late = students.filter((s) => s.submission?.late).length;

	return (
		<div className="mt-3 grid border-t md:grid-cols-[16rem_minmax(0,1fr)]">
			<nav aria-label="Siswa" className="border-b py-2 md:border-r md:border-b-0">
				<p className="px-4 py-1.5 text-xs text-muted-foreground">
					{scored
						? `${waitingOn(students, scored)} perlu dinilai`
						: `${students.filter((s) => s.submission?.status === "submitted").length} terkumpul`}{" "}
					· {late} terlambat · {students.filter(notIn).length} belum
				</p>
				<ol>
					{students.map((st) => {
						const active = st.userId === open.userId;
						return (
							<li key={st.userId}>
								<button
									type="button"
									aria-current={active ? "true" : undefined}
									onClick={() => setPicked(st.userId)}
									className={`mx-2 grid w-[calc(100%-1rem)] grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded-md px-2 py-1.5 text-left text-sm outline-ring hover:bg-muted focus-visible:outline-2 ${active ? "bg-primary/10 hover:bg-primary/10" : ""}`}
								>
									<span
										className={`truncate ${active ? "font-medium text-primary" : ""} ${notIn(st) ? "text-muted-foreground" : ""}`}
									>
										{st.name}
									</span>
									<span className="text-xs">{st.submission?.late ? <Late /> : null}</span>
									<span
										className={`col-span-2 text-xs ${st.submission?.status === "submitted" && scored ? "text-primary" : "text-muted-foreground"}`}
									>
										{rowNote(st, scored)}
									</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>
			<SubmissionPane
				key={open.userId}
				target={{ stepTitle, dueAt, rubric, scored, name: open.name, submission: open.submission }}
				// Stays on this student after a grade or return, instead of following the default to whoever waits next.
				onDone={async () => setPicked(open.userId)}
			/>
		</div>
	);
}
