// Owns: the small pieces the student's submission sheet and the teacher's grading pane share (file rows, the lateness mark, the rubric line, the return comment, the grade result, sizes). Not here: the screens that use them (src/components/submission-sheet.tsx, src/components/submission-pane.tsx).

import { CircleAlert, Download, Paperclip, X } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { Rubric } from "#/server/step-kinds";
import type { SubmissionView } from "#/server/submissions";
import { formatDayTime } from "#/lib/wib";

const SIZE = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

// "640 KB", "1,8 MB".
export function formatSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${SIZE.format(bytes / (1024 * 1024))} MB`;
}

const HOUR = 60 * 60 * 1000;

// "terlambat 8 jam". Rounded up, so a minute late never reads as "0 jam".
export function lateText(submittedAt: Date, dueAt: Date) {
	const hours = Math.ceil((submittedAt.getTime() - dueAt.getTime()) / HOUR);
	return hours < 24 ? `terlambat ${hours} jam` : `terlambat ${Math.ceil(hours / 24)} hari`;
}

// Amber, the same tone as "perlu bantuan" in the syllabus.
export function Late({ children = "terlambat" }: { children?: React.ReactNode }) {
	return <span className="text-amber-700">{children}</span>;
}

// "Dikumpulkan Sab, 15 Nov 08.12 · terlambat 8 jam". `submittedAt` is the first submit.
export function SubmittedLine({
	submission,
	dueAt,
	label = "Dikumpulkan",
}: {
	submission: Pick<SubmissionView, "submittedAt" | "late">;
	dueAt: Date | null;
	label?: string;
}) {
	const { submittedAt, late } = submission;
	if (!submittedAt) return null;
	return (
		<>
			{label} {formatDayTime(submittedAt)}
			{late && dueAt ? (
				<>
					{" · "}
					<Late>{lateText(submittedAt, dueAt)}</Late>
				</>
			) : null}
		</>
	);
}

export const rubricTotal = (rubric: Rubric) => rubric.reduce((sum, c) => sum + c.maxPoints, 0);

export function RubricLine({ rubric }: { rubric: Rubric | undefined }) {
	if (!rubric) return null;
	return (
		<p className="mt-4 text-xs text-muted-foreground">
			Rubrik: {rubric.map((c) => `${c.title} ${c.maxPoints}`).join(" · ")}
		</p>
	);
}

// The teacher's comment on returned work, above the answer it asks to change.
export function ReturnNote({ comment, at }: { comment: string; at: Date | null }) {
	return (
		<div className="grid gap-1 border-l-2 border-amber-500 pl-3">
			<p className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
				<CircleAlert aria-hidden="true" className="size-4" /> Dikembalikan
				{at ? ` · ${formatDayTime(at)}` : null}
			</p>
			<p className="text-sm whitespace-pre-wrap">{comment}</p>
		</div>
	);
}

type FileRow = SubmissionView["files"][number];

// The name downloads the file. The download icon is only a hint, so there is one link per file. `onDelete` adds a remove button, for work that is still the student's.
export function FileList({
	files,
	onDelete,
	busy = false,
}: {
	files: readonly FileRow[];
	onDelete?: (file: FileRow) => void;
	busy?: boolean;
}) {
	if (files.length === 0) return null;
	return (
		<ul className="border-y">
			{files.map((f) => (
				<li key={f.id} className="flex items-center gap-2 py-1 text-sm">
					<Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
					<a
						href={`/api/files/${f.id}`}
						download={f.filename}
						className="min-w-0 truncate underline-offset-4 hover:underline"
					>
						{f.filename}
					</a>
					<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
						{formatSize(f.size)}
					</span>
					{onDelete ? (
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							className="ml-auto"
							disabled={busy}
							aria-label={`Hapus ${f.filename}`}
							onClick={() => onDelete(f)}
						>
							<X />
						</Button>
					) : (
						<Download aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground" />
					)}
				</li>
			))}
		</ul>
	);
}

// The grade, with the same type scale as the quiz result, so a score reads the same everywhere.
// Points are read by criterion id, so a criterion the teacher removed after grading just drops out.
export function GradeResult({
	submission,
	rubric,
	className,
}: {
	submission: SubmissionView;
	rubric: Rubric | undefined;
	className: string;
}) {
	return (
		<section aria-label="Nilai" className={className}>
			<p className="text-xs text-muted-foreground">
				Nilai{submission.gradedAt ? ` · ${formatDayTime(submission.gradedAt)}` : null}
			</p>
			<p className="mt-1">
				<span className="text-5xl font-semibold tracking-tight tabular-nums">
					{submission.score}
				</span>
				<span className="text-muted-foreground"> / {rubric ? rubricTotal(rubric) : 100}</span>
			</p>
			{rubric ? (
				<ol className="mt-5 border-t">
					{rubric.map((c) => (
						<li key={c.id} className="flex items-start gap-3 border-b py-2.5">
							<div className="grid min-w-0 flex-1 gap-0.5">
								<p className="text-sm">{c.title}</p>
								{c.description ? (
									<p className="text-xs text-muted-foreground">{c.description}</p>
								) : null}
							</div>
							<p className="shrink-0 text-sm tabular-nums">
								<span className="font-medium">{submission.rubricScores?.[c.id] ?? "–"}</span>
								<span className="text-muted-foreground"> / {c.maxPoints}</span>
							</p>
						</li>
					))}
				</ol>
			) : null}
			{submission.comment ? (
				<>
					<p className="mt-4 text-xs text-muted-foreground">Komentar guru</p>
					<p className="mt-1 text-sm whitespace-pre-wrap">{submission.comment}</p>
				</>
			) : null}
		</section>
	);
}
