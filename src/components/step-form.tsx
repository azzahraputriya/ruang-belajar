// Owns: the teacher's step editor (Tulis, Pratinjau, plus Kiriman for steps that take submissions or Diskusi for discussions, title and kind fields, client checks) and the wiring that creates, updates, moves, or deletes a step through it, for quizzes too. Not here: each kind's fields and view (src/components/step-kinds-ui.tsx), a saved quiz's questions editor (src/components/quiz-editor.tsx), or the student's reader (src/components/step-reader.tsx).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";
import {
	DeleteButton,
	EditorBar,
	MoveButtons,
	UnsavedChangesGuard,
	comparableStep,
} from "#/components/editor-parts";
import { DiscussionTab, livePostCount } from "#/components/discussion-tab";
import { FormField } from "#/components/form-field";
import { QuizEditor } from "#/components/quiz-editor";
import { StepArticle } from "#/components/step-reader";
import { SubmissionsTab, waitingOn } from "#/components/submissions-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	type ContentOf,
	type FieldErrors,
	StepFields,
	StepView,
	checkStepContent,
	STEP_KIND_UI,
	takesSubmissions,
} from "#/components/step-kinds-ui";
import type { StepKind } from "#/db/content-schema";
import type { ClassId, ModuleId, StepId } from "#/db/ids";
import {
	type ModuleWithSteps,
	createStepFn,
	deleteStepFn,
	orThrow,
	reorderStepsFn,
	updateStepFn,
} from "#/server/module-fns";
import { postsQuery } from "#/server/discussion-fns";
import type { Step } from "#/server/modules";
import { stepSubmissionsQuery } from "#/server/submission-fns";

type Draft<K extends StepKind> = { title: string; content: ContentOf<K> };

type StepFormProps<K extends StepKind> = {
	kind: K;
	initial: Draft<K>;
	// For Pratinjau's "tenggat" line.
	dueAt: Date | null;
	// Throws when the server says no.
	onSave: (draft: Draft<K>) => Promise<void>;
	actions?: React.ReactNode;
	actionError?: Error | null;
	// A third tab after Pratinjau. Its content sits outside the step's <form>, so its own buttons and
	// inputs never save the step.
	extraTab?: { label: React.ReactNode; content: React.ReactNode };
};

type EditorTab = "tulis" | "pratinjau" | "extra";

export function StepForm<K extends StepKind>(props: StepFormProps<K>) {
	const { kind, initial, dueAt, onSave } = props;
	const [draft, setDraft] = useState(initial);
	const [saved, setSaved] = useState(initial);
	const [tab, setTab] = useState<EditorTab>("tulis");
	const [errors, setErrors] = useState<FieldErrors>({});
	const dirty = comparableStep(draft) !== comparableStep(saved);

	const save = useMutation({
		mutationFn: onSave,
		onSuccess: (_, value) => setSaved(value),
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const value = { ...draft, title: draft.title.trim() };
		const found: FieldErrors = {
			...(value.title ? {} : { title: "Isi judul langkah." }),
			...checkStepContent(kind, value.content),
		};
		// Fields only exist in Tulis. Render them with their errors before moving focus, so a
		// screen reader reads the field with its error.
		flushSync(() => {
			setErrors(found);
			if (Object.keys(found).length > 0) setTab("tulis");
		});
		const first = Object.keys(found)[0];
		if (first) {
			const field = form.elements.namedItem(first);
			if (field instanceof HTMLElement) field.focus();
			return;
		}
		save.mutate(value);
	}

	return (
		<Tabs
			value={tab}
			onValueChange={(value) =>
				setTab(value === "pratinjau" || value === "extra" ? value : "tulis")
			}
		>
			<form method="post" noValidate onSubmit={onSubmit}>
				<UnsavedChangesGuard dirty={dirty} />
				<div className="mx-auto w-full max-w-3xl px-4 pt-6 md:px-8">
					<EditorBar
						dirty={dirty}
						save={save}
						saveError={save.error}
						actionError={props.actionError ?? null}
						actions={props.actions}
						left={
							<TabsList>
								<TabsTrigger value="tulis">Tulis</TabsTrigger>
								<TabsTrigger value="pratinjau">Pratinjau</TabsTrigger>
								{props.extraTab ? (
									<TabsTrigger value="extra">{props.extraTab.label}</TabsTrigger>
								) : null}
							</TabsList>
						}
					/>
				</div>
				<TabsContent value="pratinjau">
					<StepArticle kind={kind} title={draft.title.trim() || "Tanpa judul"} dueAt={dueAt}>
						<StepView kind={kind} content={draft.content} title={draft.title} />
					</StepArticle>
				</TabsContent>
				<TabsContent
					value="tulis"
					className="mx-auto grid w-full max-w-3xl gap-5 px-4 pt-3 pb-8 md:px-8"
				>
					<FormField
						id="title"
						label="Judul"
						placeholder={STEP_KIND_UI[kind].label}
						maxLength={200}
						autoComplete="off"
						error={errors.title}
						value={draft.title}
						onChange={(e) => setDraft({ ...draft, title: e.target.value })}
					/>
					<StepFields
						kind={kind}
						value={draft.content}
						onChange={(content) => setDraft({ ...draft, content })}
						errors={errors}
					/>
				</TabsContent>
			</form>
			{/* Kept mounted while hidden, so a half-typed grade and the open student survive a look at Tulis. */}
			{props.extraTab ? (
				<TabsContent value="extra" forceMount className="data-[state=inactive]:hidden">
					{props.extraTab.content}
				</TabsContent>
			) : null}
		</Tabs>
	);
}

type StepEditorProps = {
	userId: string;
	classId: ClassId;
	step: Step;
	module: ModuleWithSteps;
};

// Render with key={step.id}, so the form starts from the step it shows.
export function StepEditor({ userId, classId, step, module }: StepEditorProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	// Settled either way: a refetch shows the real order, and an ids_mismatch (someone else
	// changed the module) is not retried.
	const move = useMutation({
		mutationFn: async (orderedIds: StepId[]) =>
			orThrow(await reorderStepsFn({ data: { moduleId: module.id, orderedIds } })),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["modules"] }),
	});

	// The syllabus refetches before leaving, so the class index can't resume at the deleted step.
	const remove = useMutation({
		mutationFn: async () => orThrow(await deleteStepFn({ data: { stepId: step.id } })),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["modules"] });
			await navigate({ to: "/kelas/$classId", params: { classId }, ignoreBlocker: true });
			queryClient.removeQueries({ queryKey: ["step", userId, step.id] });
		},
	});

	// The kind never changes, so the step's own kind goes with every save.
	async function onSave(draft: { title: string; content: unknown }) {
		// A new save replaces any earlier move or delete error in the bar.
		move.reset();
		remove.reset();
		orThrow(await updateStepFn({ data: { stepId: step.id, step: { kind: step.kind, ...draft } } }));
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["modules"] }),
			queryClient.invalidateQueries({ queryKey: ["step", userId, step.id] }),
		]);
	}
	const actions = (
		<>
			<MoveButtons
				ids={module.steps.map((s) => s.id)}
				id={step.id}
				what="langkah"
				pending={move.isPending}
				onMove={(ids) => move.mutate(ids)}
			/>
			<DeleteButton
				what="langkah"
				consequence={
					step.kind === "quiz"
						? "Soal dan nilai siswa di kuis ini ikut terhapus."
						: "Catatan baca siswa di langkah ini ikut terhapus."
				}
				pending={remove.isPending}
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
	const actionError = move.error ?? remove.error;

	// Assignments and reflections get a Kiriman tab. Its count shares the tab's query, so the whole list
	// loads with the editor.
	// ponytail: one class's list is small; add a per-step count query if big classes make this slow.
	const takesWork = takesSubmissions(step);
	const { data: students } = useQuery({
		...stepSubmissionsQuery(userId, step.id),
		enabled: takesWork,
	});
	const waiting = waitingOn(students, step.kind === "assignment");
	// A discussion gets a Diskusi tab in the same slot. Its count shares the tab's query too.
	const { data: posts } = useQuery({
		...postsQuery(userId, step.id),
		enabled: step.kind === "discussion",
	});
	const discussionTab =
		step.kind === "discussion"
			? {
					label: (
						<>
							Diskusi{" "}
							<span className="text-muted-foreground tabular-nums">{livePostCount(posts)}</span>
						</>
					),
					content: <DiscussionTab userId={userId} stepId={step.id} required={step.content} />,
				}
			: undefined;
	const kiriman = takesWork
		? {
				label: (
					<>
						Kiriman{" "}
						{waiting > 0 ? (
							<span className="text-muted-foreground tabular-nums">{waiting}</span>
						) : null}
					</>
				),
				content: (
					<SubmissionsTab
						userId={userId}
						stepId={step.id}
						stepTitle={step.title}
						dueAt={module.dueAt}
						// The saved rubric, not the one being edited: grades are checked against what is saved.
						rubric={step.kind === "assignment" ? step.content.rubric : undefined}
						scored={step.kind === "assignment"}
					/>
				),
			}
		: undefined;

	// A quiz's questions are rows with their own editor, so it gets a different pane.
	if (step.kind === "quiz") {
		return (
			<QuizEditor
				userId={userId}
				stepId={step.id}
				initial={{ title: step.title, content: step.content }}
				dueAt={module.dueAt}
				onSave={onSave}
				actions={actions}
				actionError={actionError}
			/>
		);
	}
	return (
		<StepForm
			kind={step.kind}
			initial={{ title: step.title, content: step.content }}
			dueAt={module.dueAt}
			onSave={onSave}
			actionError={actionError}
			actions={actions}
			extraTab={kiriman ?? discussionTab}
		/>
	);
}

type NewStepProps<K extends StepKind> = {
	classId: ClassId;
	moduleId: ModuleId;
	kind: K;
	dueAt: Date | null;
};

// Saving creates the step and opens it in its editor.
export function NewStep<K extends StepKind>({ classId, moduleId, kind, dueAt }: NewStepProps<K>) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	return (
		<StepForm
			kind={kind}
			initial={{ title: "", content: STEP_KIND_UI[kind].empty }}
			dueAt={dueAt}
			onSave={async (draft) => {
				const { step } = orThrow(
					await createStepFn({ data: { moduleId, step: { kind, ...draft } } }),
				);
				await queryClient.invalidateQueries({ queryKey: ["modules"] });
				await navigate({
					to: "/kelas/$classId/langkah/$stepId",
					params: { classId, stepId: step.id },
					ignoreBlocker: true,
				});
			}}
		/>
	);
}
