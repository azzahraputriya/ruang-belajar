// Owns: the teacher's view of one student's work on one step, in every state (not started, draft, returned, handed in, graded), with the form that grades or returns handed-in work. Used by the class-wide queue and the step editor's Kiriman tab. Not here: those lists (src/components/grading-queue.tsx, src/components/submissions-tab.tsx), pieces shared with the student's sheet (src/components/submission-parts.tsx), or grading rules (src/server/submissions.ts).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
	FileList,
	GradeResult,
	ReturnNote,
	SubmittedLine,
	rubricTotal,
} from "#/components/submission-parts";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { type RefusalOf, refusalMessage } from "#/lib/refused";
import { formatDayTime } from "#/lib/wib";
import { orThrow } from "#/server/module-fns";
import type { Rubric } from "#/server/step-kinds";
import { gradeFn, returnSubmissionFn } from "#/server/submission-fns";
import type { SubmissionView } from "#/server/submissions";

const REFUSED: Record<RefusalOf<typeof gradeFn> | RefusalOf<typeof returnSubmissionFn>, string> = {
	not_found: "Kiriman ini sudah tidak ada.",
	forbidden: "Hanya guru yang menilai.",
	not_scored: "Refleksi tidak dinilai.",
	invalid_grade: "Poin tidak sesuai rubrik. Muat ulang halaman.",
	wrong_status: "Kiriman ini sudah berubah. Muat ulang halaman.",
};

// Same cap as the server's Comment type.
const COMMENT_MAX = 5000;

export type PaneTarget = {
	stepTitle: string;
	dueAt: Date | null;
	rubric: Rubric | undefined;
	// False for reflections: they can be returned, never graded.
	scored: boolean;
	name: string;
	submission: SubmissionView | null;
};

// When the work was last handed in: the latest submit, after any returns.
export const lastSubmit = (submission: SubmissionView) =>
	submission.events.reduce<Date | null>((at, e) => (e.action === "submit" ? e.at : at), null) ??
	submission.submittedAt;

// Render with key={submission id or student id}, so the grade form starts empty for each student.
// `onDone` runs after a grade or return, before the lists refetch.
export function SubmissionPane({
	target,
	onDone,
}: {
	target: PaneTarget;
	onDone?: () => Promise<void>;
}) {
	const { submission, stepTitle, dueAt, name } = target;
	const resubmitted = (submission?.events.filter((e) => e.action === "submit").length ?? 0) > 1;
	const last = submission ? lastSubmit(submission) : null;
	const lastReturn = submission?.events.reduce<SubmissionView["events"][number] | undefined>(
		(found, e) => (e.action === "return" ? e : found),
		undefined,
	);

	let state = "";
	if (!submission) state = "Belum mulai.";
	else if (submission.status === "draft") state = "Draf, belum dikumpulkan.";
	else if (submission.status === "returned") state = "Menunggu siswa mengumpulkan lagi.";

	return (
		<section aria-label={name} className="grid max-w-2xl content-start gap-4 px-4 py-6 md:px-8">
			<div>
				<p className="text-xs text-muted-foreground">
					{stepTitle}
					{dueAt ? ` · tenggat ${formatDayTime(dueAt)}` : null}
				</p>
				<h1 className="text-xl font-semibold tracking-tight">{name}</h1>
				<p className="text-xs text-muted-foreground empty:hidden">
					{resubmitted && last ? `Dikumpulkan lagi ${formatDayTime(last)} · ` : null}
					{submission ? (
						<SubmittedLine
							submission={submission}
							dueAt={dueAt}
							label={resubmitted ? "pertama" : "Dikumpulkan"}
						/>
					) : null}
				</p>
			</div>
			{state ? <p className="text-sm text-muted-foreground">{state}</p> : null}
			{/* What the teacher asked for, while it still matters: waiting on the student, or handed in again. */}
			{lastReturn?.comment &&
			(submission?.status === "returned" || submission?.status === "submitted") ? (
				<ReturnNote comment={lastReturn.comment} at={lastReturn.at} />
			) : null}
			{submission?.text ? (
				<p className="text-sm leading-6 whitespace-pre-wrap">{submission.text}</p>
			) : null}
			{submission ? <FileList files={submission.files} /> : null}
			{submission?.status === "graded" ? (
				<GradeResult submission={submission} rubric={target.rubric} className="border-t pt-4" />
			) : null}
			{submission?.status === "submitted" ? (
				<GradeForm
					submission={submission}
					rubric={target.rubric}
					scored={target.scored}
					onDone={onDone}
				/>
			) : null}
		</section>
	);
}

function GradeForm({
	submission,
	rubric,
	scored,
	onDone,
}: {
	submission: SubmissionView;
	rubric: Rubric | undefined;
	scored: boolean;
	onDone: (() => Promise<void>) | undefined;
}) {
	const queryClient = useQueryClient();
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

	const after = {
		onSuccess: async () => {
			await onDone?.();
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
		<>
			{scored ? (
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
							<span className="w-12 whitespace-nowrap text-muted-foreground tabular-nums">
								/ 100
							</span>
						</label>
					)}
				</div>
			) : null}

			<label htmlFor={commentId} className="sr-only">
				Komentar
			</label>
			<Textarea
				id={commentId}
				ref={commentRef}
				placeholder={scored ? "Komentar. Wajib untuk Kembalikan." : "Komentar untuk Kembalikan."}
				maxLength={COMMENT_MAX}
				value={comment}
				onChange={(e) => {
					setComment(e.target.value);
					clearProblem();
				}}
				className="min-h-16"
			/>
			<div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
				<p className="mr-auto text-xs text-muted-foreground">
					{scored ? "Nilai tidak bisa diubah lagi." : "Refleksi tidak dinilai."}
				</p>
				<p role="alert" className="w-full text-right text-sm text-destructive empty:hidden">
					{error}
				</p>
				<Button type="button" variant="outline" disabled={pending} onClick={sendBack}>
					<Undo2 /> Kembalikan
				</Button>
				{scored ? (
					<Button type="button" disabled={pending} onClick={grade}>
						Nilai
					</Button>
				) : null}
			</div>
		</>
	);
}
