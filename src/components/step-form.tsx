// Owns: the teacher's step editor (Tulis and Pratinjau, title and kind fields, client checks) and the wiring that creates, updates, moves, or deletes a step through it, for quizzes too. Not here: each kind's fields and view (src/components/step-kinds-ui.tsx), a saved quiz's questions editor (src/components/quiz-editor.tsx), or the student's reader (src/components/step-reader.tsx).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";
import {
	DeleteButton,
	EditorBar,
	MoveButtons,
	UnsavedChangesGuard,
} from "#/components/editor-parts";
import { FormField } from "#/components/form-field";
import { QuizEditor } from "#/components/quiz-editor";
import { StepArticle } from "#/components/step-reader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	type ContentOf,
	type FieldErrors,
	StepFields,
	StepView,
	checkStepContent,
	STEP_KIND_UI,
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
import type { Step } from "#/server/modules";

type Draft<K extends StepKind> = { title: string; content: ContentOf<K> };

// The title is saved trimmed, so a trailing space alone doesn't count as an unsaved change.
const comparable = <K extends StepKind>(draft: Draft<K>) =>
	JSON.stringify({ ...draft, title: draft.title.trim() });

type StepFormProps<K extends StepKind> = {
	kind: K;
	initial: Draft<K>;
	// For Pratinjau's "tenggat" line.
	dueAt: Date | null;
	// Throws when the server says no.
	onSave: (draft: Draft<K>) => Promise<void>;
	actions?: React.ReactNode;
	actionFailed?: boolean;
};

export function StepForm<K extends StepKind>(props: StepFormProps<K>) {
	const { kind, initial, dueAt, onSave } = props;
	const [draft, setDraft] = useState(initial);
	const [saved, setSaved] = useState(initial);
	const [preview, setPreview] = useState(false);
	const [errors, setErrors] = useState<FieldErrors>({});
	const dirty = comparable(draft) !== comparable(saved);

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
			if (Object.keys(found).length > 0) setPreview(false);
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
		<form method="post" noValidate onSubmit={onSubmit}>
			<UnsavedChangesGuard dirty={dirty} />
			<Tabs
				value={preview ? "pratinjau" : "tulis"}
				onValueChange={(value) => setPreview(value === "pratinjau")}
			>
				<div className="mx-auto w-full max-w-3xl px-4 pt-6 md:px-8">
					<EditorBar
						dirty={dirty}
						save={save}
						saveFailed={save.isError}
						actionFailed={Boolean(props.actionFailed)}
						actions={props.actions}
						left={
							<TabsList>
								<TabsTrigger value="tulis">Tulis</TabsTrigger>
								<TabsTrigger value="pratinjau">Pratinjau</TabsTrigger>
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
			</Tabs>
		</form>
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
	const actionFailed = move.isError || remove.isError;

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
				actionFailed={actionFailed}
			/>
		);
	}
	return (
		<StepForm
			kind={step.kind}
			initial={{ title: step.title, content: step.content }}
			dueAt={module.dueAt}
			onSave={onSave}
			actionFailed={actionFailed}
			actions={actions}
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
