// Owns: the teacher's quiz editor in the step pane: the top rows (Tulis and Pratinjau with the step's own move, delete, and Simpan, then title and settings), the question list with each key, and the editor for one question, plus saving, moving, and deleting questions. Not here: saving, moving, or deleting the step (src/components/step-form.tsx), the student's screens it previews (src/components/quiz-taker.tsx), or quiz rules (src/server/quizzes.ts).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import {
	DeleteButton,
	DiscardDialog,
	EditorBar,
	MoveButtons,
	UnsavedChangesGuard,
} from "#/components/editor-parts";
import {
	QUESTION_KIND_LIST,
	QUESTION_KIND_UI,
	keyText,
	letter,
} from "#/components/question-kinds-ui";
import { QuizTaking } from "#/components/quiz-taker";
import {
	type ContentOf,
	type FieldErrors,
	QuizSettingsFields,
	checkStepContent,
} from "#/components/step-kinds-ui";
import { StepArticle } from "#/components/step-reader";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import type { QuestionId, StepId } from "#/db/ids";
import type { QuestionKind } from "#/db/quiz-schema";
import { formatDecimal, parseDecimal } from "#/lib/decimal";
import { refusalMessage } from "#/lib/refused";
import { orThrow } from "#/server/module-fns";
import {
	type TeacherQuestion,
	createQuestionFn,
	deleteQuestionFn,
	reorderQuestionsFn,
	teacherQuizQuery,
	updateQuestionFn,
} from "#/server/quiz-fns";

type StepDraft = { title: string; content: ContentOf<"quiz"> };

type QuestionRefusal = Extract<
	Awaited<
		ReturnType<
			| typeof createQuestionFn
			| typeof updateQuestionFn
			| typeof deleteQuestionFn
			| typeof reorderQuestionsFn
		>
	>,
	{ ok: false }
>["reason"];
const QUESTION_REFUSED: Record<QuestionRefusal, string> = {
	not_found: "Soal atau kuis ini sudah tidak ada. Muat ulang halaman.",
	forbidden: "Hanya guru yang bisa mengubah kuis.",
	not_a_quiz: "Langkah ini bukan kuis.",
	ids_mismatch: "Urutan soal berubah di tempat lain. Muat ulang halaman.",
};

// Every field any kind needs, side by side, so switching kinds back and forth loses nothing.
// Only the fields of the current kind are sent and compared (toPayload).
type QuestionDraft = {
	kind: QuestionKind;
	prompt: string;
	choices: { id: string; text: string }[];
	// Choice ids marked right. A single choice uses the first.
	correct: string[];
	// Number key, as typed: "19,6".
	value: string;
	tolerance: string;
	// Short answer key.
	text: string;
	feedback: string;
	solution: string;
};
type Selected = QuestionId | "new";

// Same caps as the server's question-kinds.ts.
const MAX_CHOICES = 10;
// Random, never reused: stored answers name choices by id, so a choice added later must not take a deleted
// one's id. A blank question starts at "a" and "b" instead, since nothing refers to it yet, and fixed ids
// keep the server render and the browser's first render the same. getRandomValues, not randomUUID,
// because it also works on a plain-http origin.
const newChoiceId = () =>
	Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join("");

const blankDraft = (): QuestionDraft => ({
	kind: "single_choice",
	prompt: "",
	choices: [
		{ id: "a", text: "" },
		{ id: "b", text: "" },
	],
	correct: [],
	value: "",
	tolerance: "",
	text: "",
	feedback: "",
	solution: "",
});

function fromQuestion(q: TeacherQuestion): QuestionDraft {
	const base = {
		...blankDraft(),
		kind: q.kind,
		prompt: q.prompt,
		choices: q.choices ? q.choices.map((c) => ({ ...c })) : blankDraft().choices,
		feedback: q.feedback,
		solution: q.solution,
	};
	const key = q.correct;
	if (typeof key === "string") {
		return q.kind === "short_text" ? { ...base, text: key } : { ...base, correct: [key] };
	}
	if (Array.isArray(key)) return { ...base, correct: [...key] };
	return {
		...base,
		value: formatDecimal(key.value),
		tolerance: key.tolerance ? formatDecimal(key.tolerance) : "",
	};
}

// What createQuestionFn and updateQuestionFn take. An unreadable number becomes NaN, which the
// check below refuses first.
function toPayload(d: QuestionDraft) {
	const common = {
		kind: d.kind,
		prompt: d.prompt.trim(),
		feedback: d.feedback.trim(),
		solution: d.solution.trim(),
	};
	if (d.kind === "number") {
		const tolerance = d.tolerance.trim() === "" ? 0 : parseDecimal(d.tolerance);
		return {
			...common,
			correct: { value: parseDecimal(d.value) ?? Number.NaN, tolerance: tolerance ?? Number.NaN },
		};
	}
	if (d.kind === "short_text") return { ...common, correct: d.text.trim() };
	const choices = d.choices.map((c) => ({ id: c.id, text: c.text.trim() }));
	if (d.kind === "single_choice") return { ...common, choices, correct: d.correct[0] ?? "" };
	return {
		...common,
		choices,
		correct: d.choices.filter((c) => d.correct.includes(c.id)).map((c) => c.id),
	};
}

const comparable = (d: QuestionDraft) => JSON.stringify(toPayload(d));
// The title is saved trimmed, so a trailing space alone isn't an unsaved change.
const stepComparable = (d: StepDraft) => JSON.stringify({ ...d, title: d.title.trim() });

// Error keys are element ids, so saving can focus the first field that's wrong.
function checkQuestion(d: QuestionDraft): FieldErrors {
	const errors: FieldErrors = {};
	if (!d.prompt.trim()) errors["q-prompt"] = "Isi soalnya.";
	if (d.kind === "single_choice" || d.kind === "multiple_choice") {
		const marked = d.choices.filter((c) => d.correct.includes(c.id)).length;
		if (d.choices.some((c) => !c.text.trim())) errors["q-choices"] = "Isi semua pilihan.";
		else if (marked === 0) {
			errors["q-choices"] =
				d.kind === "single_choice"
					? "Tandai satu jawaban benar."
					: "Tandai setidaknya satu jawaban benar.";
		}
	}
	if (d.kind === "number") {
		if (parseDecimal(d.value) === undefined) errors["q-value"] = "Isi angka, mis. 19,6.";
		const tolerance = parseDecimal(d.tolerance);
		if (d.tolerance.trim() !== "" && (tolerance === undefined || tolerance < 0)) {
			errors["q-tolerance"] = "Toleransi berupa angka 0 atau lebih.";
		}
	}
	if (d.kind === "short_text" && !d.text.trim()) errors["q-text"] = "Isi jawaban yang diterima.";
	return errors;
}

// A kind change keeps everything typed. Only a single choice drops all but one marked answer.
function withKind(d: QuestionDraft, kind: QuestionKind): QuestionDraft {
	return { ...d, kind, correct: kind === "single_choice" ? d.correct.slice(0, 1) : d.correct };
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
	return error ? (
		<p id={`${id}-error`} className="text-xs text-destructive">
			{error}
		</p>
	) : null;
}

const invalidProps = (id: string, errors: FieldErrors) =>
	errors[id]
		? ({ "aria-invalid": true, "aria-describedby": `${id}-error` } as const)
		: ({} as const);

// The answer key, shaped by the kind: mark the right choices, or type the value.
function KeyEditor({
	draft,
	onChange,
	errors,
}: {
	draft: QuestionDraft;
	onChange: (next: QuestionDraft) => void;
	errors: FieldErrors;
}) {
	if (draft.kind === "number") {
		return (
			<div className="grid gap-1.5">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<label htmlFor="q-value" className="text-xs text-muted-foreground">
						Jawaban
					</label>
					<Input
						id="q-value"
						inputMode="decimal"
						autoComplete="off"
						value={draft.value}
						onChange={(e) => onChange({ ...draft, value: e.target.value })}
						className="h-7 w-24 tabular-nums"
						{...invalidProps("q-value", errors)}
					/>
					<span className="text-muted-foreground">±</span>
					<Input
						id="q-tolerance"
						inputMode="decimal"
						autoComplete="off"
						aria-label="Toleransi"
						placeholder="0"
						value={draft.tolerance}
						onChange={(e) => onChange({ ...draft, tolerance: e.target.value })}
						className="h-7 w-20 tabular-nums"
						{...invalidProps("q-tolerance", errors)}
					/>
				</div>
				<FieldError id="q-value" error={errors["q-value"]} />
				<FieldError id="q-tolerance" error={errors["q-tolerance"]} />
			</div>
		);
	}
	if (draft.kind === "short_text") {
		return (
			<div className="grid gap-1.5">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<label htmlFor="q-text" className="text-xs text-muted-foreground">
						Jawaban
					</label>
					<Input
						id="q-text"
						autoComplete="off"
						maxLength={200}
						value={draft.text}
						onChange={(e) => onChange({ ...draft, text: e.target.value })}
						className="h-7 w-56"
						{...invalidProps("q-text", errors)}
					/>
					<span className="text-xs text-muted-foreground">Huruf besar dan spasi diabaikan.</span>
				</div>
				<FieldError id="q-text" error={errors["q-text"]} />
			</div>
		);
	}

	const single = draft.kind === "single_choice";
	const setChoice = (id: string, text: string) =>
		onChange({ ...draft, choices: draft.choices.map((c) => (c.id === id ? { id, text } : c)) });
	const rows = draft.choices.map((c, i) => (
		<div key={c.id} className="flex items-center gap-2">
			{single ? (
				<RadioGroupItem value={c.id} aria-label={`${letter(i)} benar`} />
			) : (
				<Checkbox
					aria-label={`${letter(i)} benar`}
					checked={draft.correct.includes(c.id)}
					onCheckedChange={(on) =>
						onChange({
							...draft,
							correct:
								on === true ? [...draft.correct, c.id] : draft.correct.filter((id) => id !== c.id),
						})
					}
				/>
			)}
			<span className="w-4 text-center text-xs text-muted-foreground">{letter(i)}</span>
			<Input
				id={i === 0 ? "q-choices" : undefined}
				aria-label={`Pilihan ${letter(i)}`}
				autoComplete="off"
				maxLength={2000}
				value={c.text}
				onChange={(e) => setChoice(c.id, e.target.value)}
				className="h-7"
				{...(i === 0 ? invalidProps("q-choices", errors) : {})}
			/>
			<Button
				type="button"
				size="icon-xs"
				variant="ghost"
				aria-label={`Hapus pilihan ${letter(i)}`}
				disabled={draft.choices.length <= 2}
				onClick={() =>
					onChange({
						...draft,
						choices: draft.choices.filter((x) => x.id !== c.id),
						correct: draft.correct.filter((id) => id !== c.id),
					})
				}
			>
				<X />
			</Button>
		</div>
	));
	return (
		<div className="grid gap-1.5">
			<p className="text-xs text-muted-foreground">
				{single ? "Tandai satu jawaban benar" : "Tandai semua jawaban benar"}
			</p>
			{single ? (
				<RadioGroup
					aria-label="Jawaban benar"
					value={draft.correct[0] ?? ""}
					onValueChange={(id) => onChange({ ...draft, correct: [id] })}
					className="gap-1.5"
				>
					{rows}
				</RadioGroup>
			) : (
				rows
			)}
			<Button
				type="button"
				size="xs"
				variant="ghost"
				className="justify-self-start text-muted-foreground"
				disabled={draft.choices.length >= MAX_CHOICES}
				onClick={() =>
					onChange({
						...draft,
						choices: [...draft.choices, { id: newChoiceId(), text: "" }],
					})
				}
			>
				<Plus /> Pilihan
			</Button>
			<FieldError id="q-choices" error={errors["q-choices"]} />
		</div>
	);
}

// Focuses the first field with an error. Returns false when there was none.
function focusFirst(form: HTMLFormElement, errors: FieldErrors) {
	const first = Object.keys(errors)[0];
	if (!first) return false;
	const field = form.querySelector(`#${first}`);
	if (field instanceof HTMLElement) field.focus();
	return true;
}

type QuizEditorProps = {
	userId: string;
	stepId: StepId;
	initial: StepDraft;
	// For Pratinjau's "tenggat" line.
	dueAt: Date | null;
	// The step's own save, move, and delete, wired by StepEditor. onSave throws when the server says no.
	onSave: (draft: StepDraft) => Promise<void>;
	actions: React.ReactNode;
	actionError: Error | null;
};

// Render with key={stepId}. The step (title and settings) and the open question save separately,
// each with its own button, and the page asks before either's unsaved edits are lost.
export function QuizEditor(props: QuizEditorProps) {
	const { userId, stepId, initial, dueAt, onSave } = props;
	const queryClient = useQueryClient();
	const quizKey = teacherQuizQuery(userId, stepId).queryKey;
	const { data: questions } = useSuspenseQuery(teacherQuizQuery(userId, stepId));

	// The step: title and settings.
	const [draft, setDraft] = useState(initial);
	const [saved, setSaved] = useState(initial);
	const [stepErrors, setStepErrors] = useState<FieldErrors>({});
	const [preview, setPreview] = useState(false);
	const stepDirty = stepComparable(draft) !== stepComparable(saved);
	const saveStep = useMutation({ mutationFn: onSave, onSuccess: (_, value) => setSaved(value) });

	// The open question. A new question has no id until it's saved.
	const [selected, setSelected] = useState<Selected>(() => questions[0]?.id ?? "new");
	const [qDraft, setQDraft] = useState(() =>
		questions[0] ? fromQuestion(questions[0]) : blankDraft(),
	);
	const [qSaved, setQSaved] = useState(qDraft);
	const [qErrors, setQErrors] = useState<FieldErrors>({});
	// Where the teacher asked to go while the open question had unsaved edits.
	const [pending, setPending] = useState<Selected | null>(null);
	const qDirty = comparable(qDraft) !== comparable(qSaved);

	const saveQuestion = useMutation({
		mutationFn: async ({ target, value }: { target: Selected; value: QuestionDraft }) => {
			const question = toPayload(value);
			if (target === "new") {
				return orThrow(await createQuestionFn({ data: { stepId, question } })).question;
			}
			return orThrow(await updateQuestionFn({ data: { questionId: target, question } })).question;
		},
		// The list refetches first, so a new question is in it by the time it's selected.
		onSuccess: async (question, { value }) => {
			await queryClient.invalidateQueries({ queryKey: quizKey });
			setSelected(question.id);
			setQSaved(value);
		},
	});
	const moveQuestion = useMutation({
		mutationFn: async (orderedIds: QuestionId[]) =>
			orThrow(await reorderQuestionsFn({ data: { stepId, orderedIds } })),
		onSettled: () => queryClient.invalidateQueries({ queryKey: quizKey }),
	});
	const removeQuestion = useMutation({
		mutationFn: async (questionId: QuestionId) =>
			orThrow(await deleteQuestionFn({ data: { questionId } })),
		onSuccess: async (_, questionId) => {
			const at = questions.findIndex((q) => q.id === questionId);
			const neighbor = questions[at + 1] ?? questions[at - 1];
			await queryClient.invalidateQueries({ queryKey: quizKey });
			open(neighbor?.id ?? "new", neighbor);
		},
	});
	// Switching while a save or delete is in flight would pair its result with the wrong question.
	const busy = saveQuestion.isPending || removeQuestion.isPending;
	const questionError = refusalMessage(
		saveQuestion.error ?? moveQuestion.error ?? removeQuestion.error,
		QUESTION_REFUSED,
		"Tidak bisa menyimpan. Coba lagi.",
	);
	const resetQuestionActions = () => {
		saveQuestion.reset();
		moveQuestion.reset();
		removeQuestion.reset();
	};

	// `found` is passed when the list is about to change and may not hold the question yet.
	function open(target: Selected, found?: TeacherQuestion) {
		const q = found ?? questions.find((x) => x.id === target);
		const base = q ? fromQuestion(q) : blankDraft();
		setSelected(q ? q.id : "new");
		setQDraft(base);
		setQSaved(base);
		setQErrors({});
		resetQuestionActions();
	}
	const request = (target: Selected) => (qDirty ? setPending(target) : open(target));

	function onSubmitStep(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const value = { ...draft, title: draft.title.trim() };
		const found: FieldErrors = {
			...(value.title ? {} : { title: "Isi judul langkah." }),
			...checkStepContent("quiz", value.content),
		};
		setStepErrors(found);
		if (!focusFirst(event.currentTarget, found)) saveStep.mutate(value);
	}

	function onSubmitQuestion(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const found = checkQuestion(qDraft);
		setQErrors(found);
		if (focusFirst(event.currentTarget, found)) return;
		resetQuestionActions();
		saveQuestion.mutate({ target: selected, value: qDraft });
	}

	const ids = questions.map((q) => q.id);
	const number = selected === "new" ? questions.length + 1 : ids.indexOf(selected) + 1;
	let qState = "";
	if (qDirty) qState = "Belum disimpan";
	else if (saveQuestion.isSuccess) qState = "Tersimpan";

	return (
		<>
			<UnsavedChangesGuard dirty={stepDirty || qDirty} />
			<DiscardDialog
				open={pending !== null}
				onStay={() => setPending(null)}
				onLeave={() => {
					if (pending) open(pending);
					setPending(null);
				}}
			/>
			<Tabs
				value={preview ? "pratinjau" : "tulis"}
				onValueChange={(value) => setPreview(value === "pratinjau")}
				className="gap-0"
			>
				<form method="post" noValidate onSubmit={onSubmitStep} className="px-4 pt-6 md:px-8">
					<EditorBar
						dirty={stepDirty}
						save={saveStep}
						saveError={saveStep.error}
						actionError={props.actionError}
						actions={props.actions}
						left={
							<TabsList>
								<TabsTrigger value="tulis">Tulis</TabsTrigger>
								<TabsTrigger value="pratinjau">Pratinjau</TabsTrigger>
							</TabsList>
						}
					/>
					{/* Its own row: beside the tabs and actions it wraps once "Belum disimpan" shows. */}
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
						<Input
							id="title"
							name="title"
							aria-label="Judul"
							placeholder="Kuis"
							maxLength={200}
							autoComplete="off"
							value={draft.title}
							onChange={(e) => setDraft({ ...draft, title: e.target.value })}
							className="h-8 w-64 max-w-full font-medium"
							{...invalidProps("title", stepErrors)}
						/>
						<QuizSettingsFields
							inline
							value={draft.content}
							onChange={(content) => setDraft({ ...draft, content })}
							errors={stepErrors}
						/>
					</div>
					<p role="alert" className="text-sm text-destructive empty:hidden">
						{Object.values(stepErrors)[0]}
					</p>
				</form>

				<TabsContent value="pratinjau">
					<StepArticle kind="quiz" title={draft.title.trim() || "Tanpa judul"} dueAt={dueAt}>
						<QuizTaking
							questions={questions}
							attemptLabel={`Percobaan 1/${draft.content.maxAttempts}`}
						/>
					</StepArticle>
				</TabsContent>

				<TabsContent
					value="tulis"
					className="mt-4 grid border-t md:grid-cols-[18rem_minmax(0,1fr)]"
				>
					<nav aria-label="Soal" className="border-b py-2 md:border-r md:border-b-0">
						<ol>
							{questions.map((q, i) => {
								const active = q.id === selected;
								return (
									<li key={q.id}>
										<button
											type="button"
											aria-current={active ? "true" : undefined}
											disabled={busy}
											onClick={() => request(q.id)}
											className={`mx-2 grid w-[calc(100%-1rem)] grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-2 text-left text-sm outline-ring focus-visible:outline-2 ${active ? "bg-primary/10" : "hover:bg-muted"}`}
										>
											<span className="text-muted-foreground tabular-nums">{i + 1}</span>
											<span className={`truncate ${active ? "font-medium text-primary" : ""}`}>
												{q.prompt}
											</span>
											<span className="col-start-2 flex gap-2 text-xs text-muted-foreground">
												<span className="w-10 shrink-0">{QUESTION_KIND_UI[q.kind].short}</span>
												<span className="truncate font-medium text-foreground">
													{keyText(q, q.correct, "letter")}
												</span>
											</span>
										</button>
									</li>
								);
							})}
							{selected === "new" ? (
								<li className="mx-2 grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 rounded-md bg-primary/10 px-2 py-2 text-sm">
									<span className="text-muted-foreground tabular-nums">{number}</span>
									<span className="truncate font-medium text-primary">
										{qDraft.prompt.trim() || "Soal baru"}
									</span>
								</li>
							) : null}
						</ol>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="mx-2 mt-1 text-muted-foreground"
							disabled={busy || selected === "new"}
							onClick={() => request("new")}
						>
							<Plus /> Soal
						</Button>
					</nav>

					<form
						method="post"
						noValidate
						onSubmit={onSubmitQuestion}
						aria-label={`Soal ${number}`}
						className="grid max-w-2xl content-start gap-4 px-4 py-5 md:px-8"
					>
						<div className="flex items-center gap-2">
							<h2 className="text-sm font-medium">Soal {number}</h2>
							<Select
								value={qDraft.kind}
								onValueChange={(value) => {
									const kind = QUESTION_KIND_LIST.find((k) => k === value);
									if (kind) setQDraft(withKind(qDraft, kind));
								}}
							>
								<SelectTrigger size="sm" aria-label="Jenis soal">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{QUESTION_KIND_LIST.map((k) => (
										<SelectItem key={k} value={k}>
											{QUESTION_KIND_UI[k].label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{selected === "new" ? null : (
								<span className="ml-auto flex">
									<MoveButtons
										ids={ids}
										id={selected}
										what="soal"
										pending={moveQuestion.isPending}
										onMove={(orderedIds) => {
											resetQuestionActions();
											moveQuestion.mutate(orderedIds);
										}}
									/>
									<DeleteButton
										what="soal"
										consequence="Nilai siswa yang sudah masuk tidak berubah."
										pending={removeQuestion.isPending}
										onConfirm={() => {
											resetQuestionActions();
											removeQuestion.mutate(selected);
										}}
									/>
								</span>
							)}
						</div>
						<div className="grid gap-1.5">
							<Textarea
								id="q-prompt"
								aria-label="Soal"
								placeholder="Tulis soal…"
								maxLength={100_000}
								value={qDraft.prompt}
								onChange={(e) => setQDraft({ ...qDraft, prompt: e.target.value })}
								className="min-h-20"
								{...invalidProps("q-prompt", qErrors)}
							/>
							<FieldError id="q-prompt" error={qErrors["q-prompt"]} />
						</div>
						<KeyEditor draft={qDraft} onChange={setQDraft} errors={qErrors} />
						<div className="grid gap-1.5">
							<label htmlFor="q-feedback" className="text-xs text-muted-foreground">
								Umpan balik
							</label>
							<Textarea
								id="q-feedback"
								maxLength={100_000}
								value={qDraft.feedback}
								onChange={(e) => setQDraft({ ...qDraft, feedback: e.target.value })}
								className="min-h-9"
							/>
						</div>
						<div className="grid gap-1.5">
							<label htmlFor="q-solution" className="text-xs text-muted-foreground">
								Pembahasan · tampil setelah lulus
							</label>
							<Textarea
								id="q-solution"
								maxLength={100_000}
								value={qDraft.solution}
								onChange={(e) => setQDraft({ ...qDraft, solution: e.target.value })}
								className="min-h-16"
							/>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-3 border-t pt-3">
							<p role="alert" className="mr-auto text-sm text-destructive empty:hidden">
								{questionError}
							</p>
							<output className="text-xs text-muted-foreground">{qState}</output>
							<Button type="submit" size="sm" disabled={saveQuestion.isPending}>
								{saveQuestion.isPending ? "Menyimpan…" : "Simpan soal"}
							</Button>
						</div>
					</form>
				</TabsContent>
			</Tabs>
		</>
	);
}
