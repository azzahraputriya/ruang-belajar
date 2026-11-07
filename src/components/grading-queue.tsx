// Owns: the teacher's class-wide grading queue (work waiting per step, who hasn't handed in, and the pane that grades or returns one piece of work). Not here: the route (src/routes/_app/kelas/$classId/nilai.tsx), pieces shared with the student's sheet (src/components/submission-parts.tsx), or grading rules (src/server/submissions.ts).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { PaneMessage } from "#/components/pane-message";
import {
	FileList,
	Late,
	ReturnNote,
	SubmittedLine,
	rubricTotal,
} from "#/components/submission-parts";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import type { ClassId } from "#/db/ids";
import { type RefusalOf, refusalMessage } from "#/lib/refused";
import { formatDay, formatDayTime } from "#/lib/wib";
import { orThrow } from "#/server/module-fns";
import {
	type GradingQueue as Queue,
	gradeFn,
	gradingQueueQuery,
	returnSubmissionFn,
} from "#/server/submission-fns";

type QueueStep = Queue["steps"][number];
type Waiting = QueueStep["waiting"][number];

const REFUSED: Record<RefusalOf<typeof gradeFn> | RefusalOf<typeof returnSubmissionFn>, string> = {
	not_found: "Kiriman ini sudah tidak ada.",
	forbidden: "Hanya guru yang menilai.",
	not_scored: "Langkah ini tidak dinilai.",
	invalid_grade: "Poin tidak sesuai rubrik. Muat ulang halaman.",
	wrong_status: "Kiriman ini sudah berubah. Muat ulang halaman.",
};

// Same cap as the server's Comment type.
const COMMENT_MAX = 5000;

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
			<GradePane
				key={open.item.submission.id}
				step={open.step}
				item={open.item}
				onDone={openNext}
			/>
		</div>
	);
}

// When the work was last handed in: the latest submit, after any returns.
const lastSubmit = (submission: Waiting["submission"]) =>
	submission.events.reduce<Date | null>((at, e) => (e.action === "submit" ? e.at : at), null) ??
	submission.submittedAt;

function GradePane({
	step,
	item,
	onDone,
}: {
	step: QueueStep;
	item: Waiting;
	onDone: () => Promise<void>;
}) {
	const queryClient = useQueryClient();
	const { submission } = item;
	const rubric = step.rubric;
	const commentId = useId();
	const commentRef = useRef<HTMLTextAreaElement>(null);
	const pointsRef = useRef<Record<string, HTMLInputElement | null>>({});

	// Text boxes, so a half-typed number stays as typed. Parsed when "Nilai" is pressed.
	const [points, setPoints] = useState<Record<string, string>>({});
	const [comment, setComment] = useState("");
	const [problem, setProblem] = useState("");
	const [bad, setBad] = useState<string | undefined>();

	const total = rubric
		? rubric.reduce((sum, c) => sum + (Number.parseInt(points[c.id] ?? "", 10) || 0), 0)
		: undefined;
	const returns = submission.events.filter((e) => e.action === "return");
	const lastReturn = returns.at(-1);
	const resubmitted = submission.events.filter((e) => e.action === "submit").length > 1;
	const last = lastSubmit(submission);

	const after = {
		onSuccess: async () => {
			await onDone();
			await queryClient.invalidateQueries({ queryKey: ["grading"] });
		},
	};
	const gradeIt = useMutation({
		mutationFn: async (input: Parameters<typeof gradeFn>[0]["data"]["grade"]) =>
			orThrow(await gradeFn({ data: { submissionId: submission.id, grade: input } })),
		...after,
	});
	const returnIt = useMutation({
		mutationFn: async (text: string) =>
			orThrow(
				await returnSubmissionFn({
					data: { submissionId: submission.id, input: { comment: text } },
				}),
			),
		...after,
	});
	const pending = gradeIt.isPending || returnIt.isPending;

	// Any edit may fix what the last check flagged, so its message goes until the next press.
	const clearProblem = () => {
		setProblem("");
		setBad(undefined);
	};

	// Whole points within each criterion's range, or one 0 to 100 score without a rubric.
	function readPoints() {
		const ranges = rubric ?? [{ id: "score", title: "Nilai", maxPoints: 100 }];
		const read: Record<string, number> = {};
		for (const c of ranges) {
			const raw = (points[c.id] ?? "").trim();
			const n = Number(raw);
			if (raw === "" || !Number.isInteger(n) || n < 0 || n > c.maxPoints) {
				return { bad: c.id, message: `Isi poin ${c.title} 0 sampai ${c.maxPoints}.` };
			}
			read[c.id] = n;
		}
		return { read };
	}

	function grade() {
		const result = readPoints();
		setBad(result.bad);
		setProblem(result.message ?? "");
		if (!result.read) {
			pointsRef.current[result.bad]?.focus();
			return;
		}
		gradeIt.mutate(
			rubric ? { points: result.read, comment } : { score: result.read.score, comment },
		);
	}

	function sendBack() {
		setBad(undefined);
		if (!comment.trim()) {
			setProblem("Tulis komentar untuk Kembalikan.");
			commentRef.current?.focus();
			return;
		}
		setProblem("");
		returnIt.mutate(comment);
	}

	const pointInput = (id: string, label: string, max: number) => (
		<Input
			ref={(el) => {
				pointsRef.current[id] = el;
			}}
			aria-label={label}
			aria-invalid={bad === id ? true : undefined}
			type="number"
			inputMode="numeric"
			min={0}
			max={max}
			value={points[id] ?? ""}
			onChange={(e) => {
				setPoints((p) => ({ ...p, [id]: e.target.value }));
				clearProblem();
			}}
			className="h-8 w-16 tabular-nums"
		/>
	);

	const error =
		problem ||
		refusalMessage(gradeIt.error ?? returnIt.error, REFUSED, "Tidak bisa menyimpan. Coba lagi.");

	return (
		<section
			aria-label={item.name}
			className="grid max-w-2xl content-start gap-4 px-4 py-6 md:px-8"
		>
			<div>
				<p className="text-xs text-muted-foreground">
					{step.title}
					{step.dueAt ? ` · tenggat ${formatDayTime(step.dueAt)}` : null}
				</p>
				<h1 className="text-xl font-semibold tracking-tight">{item.name}</h1>
				<p className="text-xs text-muted-foreground">
					{resubmitted && last ? `Dikumpulkan lagi ${formatDayTime(last)} · ` : null}
					<SubmittedLine
						submission={submission}
						dueAt={step.dueAt}
						label={resubmitted ? "pertama" : "Dikumpulkan"}
					/>
				</p>
			</div>
			{lastReturn?.comment ? <ReturnNote comment={lastReturn.comment} at={lastReturn.at} /> : null}
			{submission.text ? (
				<p className="text-sm leading-6 whitespace-pre-wrap">{submission.text}</p>
			) : null}
			<FileList files={submission.files} />

			<div className="grid gap-2">
				{rubric ? (
					<>
						{rubric.map((c) => (
							<label key={c.id} className="flex items-center gap-3 text-sm">
								<span className="min-w-0 flex-1">
									{c.title}
									{c.description ? (
										<span className="block text-xs text-muted-foreground">{c.description}</span>
									) : null}
								</span>
								{pointInput(c.id, `Poin ${c.title}`, c.maxPoints)}
								<span className="w-12 whitespace-nowrap text-muted-foreground tabular-nums">
									/ {c.maxPoints}
								</span>
							</label>
						))}
						<p className="flex items-center gap-3 border-t pt-2 text-sm">
							<span className="flex-1 font-medium">Total</span>
							<span className="w-16 px-2.5 font-semibold tabular-nums">{total}</span>
							<span className="w-12 whitespace-nowrap text-muted-foreground tabular-nums">
								/ {rubricTotal(rubric)}
							</span>
						</p>
					</>
				) : (
					<label className="flex items-center gap-3 text-sm">
						<span className="flex-1 font-medium">Nilai</span>
						{pointInput("score", "Nilai", 100)}
						<span className="w-12 whitespace-nowrap text-muted-foreground tabular-nums">/ 100</span>
					</label>
				)}
			</div>

			<label htmlFor={commentId} className="sr-only">
				Komentar
			</label>
			<Textarea
				id={commentId}
				ref={commentRef}
				placeholder="Komentar. Wajib untuk Kembalikan."
				maxLength={COMMENT_MAX}
				value={comment}
				onChange={(e) => {
					setComment(e.target.value);
					clearProblem();
				}}
				className="min-h-16"
			/>
			<div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
				<p className="mr-auto text-xs text-muted-foreground">Nilai tidak bisa diubah lagi.</p>
				<p role="alert" className="w-full text-right text-sm text-destructive empty:hidden">
					{error}
				</p>
				<Button variant="outline" disabled={pending} onClick={sendBack}>
					<Undo2 /> Kembalikan
				</Button>
				<Button disabled={pending} onClick={grade}>
					Nilai
				</Button>
			</div>
		</section>
	);
}
