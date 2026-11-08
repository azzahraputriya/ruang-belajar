// Owns: the student's assignment and reflection screen inside the step pane (prompt, their answer with autosave, files, submitting, and what a return or a grade shows them). Not here: the step header (src/components/step-reader.tsx), the pieces shared with the grading pane (src/components/submission-parts.tsx), or submission rules (src/server/submissions.ts).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type } from "arktype";
import { ArrowRight, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "#/components/step-kinds-ui";
import { MARKDOWN_MAX } from "#/lib/markdown-field";
import {
	FileList,
	GradeResult,
	ReturnNote,
	RubricLine,
	SubmittedLine,
} from "#/components/submission-parts";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import type { ClassId, StepId } from "#/db/ids";
import { type RefusalOf, Refused, refusalMessage } from "#/lib/refused";
import { FILE_LIMITS, UPLOAD_ACCEPT, UPLOAD_EXTENSIONS } from "#/lib/upload-limits";
import { formatSaved } from "#/lib/wib";
import { orThrow } from "#/server/module-fns";
import type { Step } from "#/server/modules";
import type { uploadFile } from "#/server/submission-files";
import { deleteFileFn, mySubmissionQuery, saveDraftFn, submitFn } from "#/server/submission-fns";
import type { SubmissionView } from "#/server/submissions";

const MAX_MB = FILE_LIMITS.maxBytes / (1024 * 1024);

const WORK_REFUSED: Record<RefusalOf<typeof saveDraftFn> | RefusalOf<typeof submitFn>, string> = {
	not_found: "Langkah ini sudah tidak ada.",
	forbidden: "Hanya siswa yang mengumpulkan.",
	not_a_submission_step: "Langkah ini tidak menerima kiriman.",
	text_not_accepted: "Tugas ini hanya menerima berkas.",
	wrong_status: "Kirimanmu sudah berubah. Muat ulang halaman.",
	empty: "Isi jawaban atau lampirkan berkas dulu.",
};

const UPLOAD_REFUSED: Record<
	RefusalOf<typeof uploadFile> | RefusalOf<typeof deleteFileFn> | "no_file",
	string
> = {
	...WORK_REFUSED,
	file_too_large: `Berkas lebih dari ${MAX_MB} MB.`,
	files_not_accepted: "Tugas ini tidak menerima berkas.",
	file_type_not_allowed: "Jenis berkas ini tidak diterima.",
	too_many_files: `Maksimal ${FILE_LIMITS.perSubmission} berkas.`,
	no_file: "Pilih berkas dulu.",
};

const FILE_HINT = `Maks. ${FILE_LIMITS.perSubmission} berkas, ${MAX_MB} MB. ${UPLOAD_EXTENSIONS.join(", ").toUpperCase()}.`;

// The upload route answers with JSON. Only its reason is read, so a proxy's HTML error page still
// ends as the fallback message.
const UploadAnswer = type({ reason: "string" });

// Waits this long after the last keystroke before saving the draft.
const SAVE_DELAY_MS = 800;

type SubmissionStep = Step & { kind: "assignment" | "reflection" };

type SheetProps = {
	userId: string;
	classId: ClassId;
	step: SubmissionStep;
	dueAt: Date | null;
	nextStepId: StepId | undefined;
};

// Render with key={step.id}, so the answer box starts from this step's saved text.
export function SubmissionSheet({ userId, classId, step, dueAt, nextStepId }: SheetProps) {
	const queryClient = useQueryClient();
	const query = mySubmissionQuery(userId, step.id);
	const { data } = useSuspenseQuery(query);
	const sub = data.submission;
	const status = sub?.status ?? "draft";
	const editable = status === "draft" || status === "returned";
	const assignment = step.kind === "assignment";
	const rubric = step.kind === "assignment" ? step.content.rubric : undefined;
	const accepts = data.accepts;

	const put = (next: SubmissionView) =>
		queryClient.setQueryData(query.queryKey, (old) => old && { ...old, submission: next });
	const refetch = () => queryClient.invalidateQueries({ queryKey: query.queryKey });

	// The box keeps its own text. A refetch (say, on window focus) must not overwrite typing.
	const [text, setText] = useState(sub?.text ?? "");
	const latest = useRef(text);
	latest.current = text;
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	// Saves run one after another, so an older save can never land after a newer one or a submit.
	const chain = useRef<Promise<unknown>>(Promise.resolve());
	const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");

	// Saves `value` unless the server already has it. Resolves once it is saved, rejects if it can't be.
	function persist(value: string) {
		const run = chain.current
			.catch(() => undefined)
			.then(async () => {
				const stored = queryClient.getQueryData(query.queryKey)?.submission?.text ?? "";
				if (value === stored) return;
				setSaveState("saving");
				const saved = orThrow(await saveDraftFn({ data: { stepId: step.id, text: value } }));
				put(saved.submission);
				setSaveState("idle");
			});
		run.catch(() => setSaveState("error"));
		chain.current = run;
		return run;
	}

	useEffect(() => {
		if (!editable || !accepts.text) return undefined;
		timer.current = setTimeout(() => void persist(text), SAVE_DELAY_MS);
		return () => clearTimeout(timer.current);
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- persist only reads refs and the cache, and listing it would restart the timer every render.
	}, [text, editable, accepts.text]);

	// Leaving the step before the timer fires still saves the last words typed.
	const typing = useRef(false);
	typing.current = editable && accepts.text;
	useEffect(
		() => () => {
			if (typing.current) void persist(latest.current);
		},
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- Runs once, on leaving. It reads the latest text through refs.
		[],
	);

	const submit = useMutation({
		mutationFn: async () => {
			clearTimeout(timer.current);
			if (accepts.text) await persist(latest.current);
			return orThrow(await submitFn({ data: { stepId: step.id } }));
		},
		onSuccess: async (result) => {
			put(result.submission);
			await queryClient.invalidateQueries({ queryKey: ["progress"] });
		},
	});

	const fileInput = useRef<HTMLInputElement>(null);
	const upload = useMutation({
		mutationFn: async (files: readonly File[]) => {
			for (const file of files) {
				if (file.size > FILE_LIMITS.maxBytes) throw new Refused("file_too_large");
				const form = new FormData();
				form.append("file", file);
				// No Content-Type header: the browser adds it with the form's boundary.
				// oxlint-disable-next-line no-await-in-loop -- One at a time, so the server counts the file cap in order.
				const response = await fetch(`/api/files/upload/${step.id}`, {
					method: "POST",
					body: form,
				});
				if (!response.ok) {
					// oxlint-disable-next-line no-await-in-loop -- Same loop, reading this file's refusal.
					const answer = UploadAnswer(await response.json().catch(() => undefined));
					throw new Refused(answer instanceof type.errors ? "upload_failed" : answer.reason);
				}
			}
		},
		onSettled: refetch,
	});
	const remove = useMutation({
		mutationFn: async (fileId: SubmissionView["files"][number]["id"]) =>
			orThrow(await deleteFileFn({ data: { fileId } })),
		onSettled: refetch,
	});

	const busy = submit.isPending || upload.isPending || remove.isPending;
	const returns = sub?.events.filter((e) => e.action === "return").length ?? 0;

	let footNote = "";
	if (status === "submitted") footNote = assignment ? "Menunggu dinilai." : "Terkumpul.";
	else if (editable && saveState === "saving") footNote = "Menyimpan…";
	else if (status === "draft" && sub && accepts.text) {
		footNote = `Draf · tersimpan ${formatSaved(sub.updatedAt)}`;
	} else if (status === "returned" && sub?.returnedAt && sub.updatedAt > sub.returnedAt) {
		// The return itself touches the row too, so only a save after it counts.
		footNote = `Tersimpan ${formatSaved(sub.updatedAt)}`;
	}

	return (
		<>
			{assignment ? null : (
				<p className="-mt-4 mb-6 text-sm text-muted-foreground">Tidak dinilai.</p>
			)}
			<Markdown>{step.content.prompt}</Markdown>
			<RubricLine rubric={rubric} />

			{status === "graded" && sub ? (
				<GradeResult submission={sub} rubric={rubric} className="mt-8 border-t pt-6" />
			) : null}

			<section aria-labelledby="jawaban" className="mt-8 grid gap-3 border-t pt-6">
				<div className="flex flex-wrap items-baseline gap-x-2 text-sm">
					<h2 id="jawaban" className="font-medium">
						{assignment ? "Jawabanmu" : "Refleksimu"}
					</h2>
					<span className="text-muted-foreground">
						{sub ? <SubmittedLine submission={sub} dueAt={dueAt} /> : null}
						{status === "graded" && returns > 0 ? ` · dikembalikan ${returns} kali` : null}
					</span>
				</div>

				{status === "returned" && sub?.comment ? (
					<ReturnNote comment={sub.comment} at={sub.returnedAt} />
				) : null}

				{accepts.text ? (
					editable ? (
						<Textarea
							aria-labelledby="jawaban"
							className="min-h-40"
							maxLength={MARKDOWN_MAX}
							value={text}
							disabled={submit.isPending}
							onChange={(e) => setText(e.target.value)}
						/>
					) : (
						<p className="text-sm leading-6 whitespace-pre-wrap">{sub?.text}</p>
					)
				) : null}

				{accepts.files ? (
					<>
						<FileList
							files={sub?.files ?? []}
							onDelete={editable ? (f) => remove.mutate(f.id) : undefined}
							busy={busy}
						/>
						{editable ? (
							<div className="flex flex-wrap items-center gap-3">
								<input
									ref={fileInput}
									type="file"
									multiple
									accept={UPLOAD_ACCEPT}
									className="sr-only"
									tabIndex={-1}
									aria-hidden="true"
									onChange={(e) => {
										const picked = Array.from(e.target.files ?? []);
										e.target.value = "";
										if (picked.length > 0) upload.mutate(picked);
									}}
								/>
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() => fileInput.current?.click()}
								>
									<Paperclip /> {upload.isPending ? "Mengunggah…" : "Lampirkan"}
								</Button>
								<span className="text-xs text-muted-foreground">{FILE_HINT}</span>
							</div>
						) : null}
					</>
				) : null}
				<p role="alert" className="text-sm text-destructive empty:hidden">
					{refusalMessage(
						upload.error ?? remove.error,
						UPLOAD_REFUSED,
						"Berkas gagal diproses. Coba lagi.",
					)}
				</p>
			</section>

			<div className="mt-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t pt-4">
				<p className="mr-auto text-sm text-muted-foreground empty:hidden">{footNote}</p>
				<p role="alert" className="text-sm text-destructive empty:hidden">
					{saveState === "error" && !submit.isError ? "Draf tidak tersimpan. Coba lagi." : ""}
					{refusalMessage(submit.error, WORK_REFUSED, "Tidak bisa mengumpulkan. Coba lagi.")}
				</p>
				{editable ? (
					<Button disabled={busy} onClick={() => submit.mutate()}>
						{status === "returned" ? "Kumpulkan lagi" : "Kumpulkan"}
					</Button>
				) : null}
				{!editable && nextStepId ? (
					<Button variant="outline" asChild>
						<Link to="/kelas/$classId/langkah/$stepId" params={{ classId, stepId: nextStepId }}>
							Lanjut <ArrowRight />
						</Link>
					</Button>
				) : null}
			</div>
		</>
	);
}
