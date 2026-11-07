// Owns: the teacher's step editor (Tulis and Pratinjau, title and kind fields, client checks) and the wiring that creates or updates a step through it. Not here: each kind's fields and view (src/components/step-kinds-ui.tsx) or the student's reader (src/components/step-reader.tsx).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";
import { EditorBar } from "#/components/editor-parts";
import { FormField } from "#/components/form-field";
import { StepArticle } from "#/components/step-reader";
import {
	type ContentOf,
	type FieldErrors,
	StepFields,
	checkStepContent,
	STEP_KIND_UI,
} from "#/components/step-kinds-ui";
import type { StepKind } from "#/db/content-schema";
import type { ClassId, ModuleId } from "#/db/ids";
import { createStepFn, orThrow, updateStepFn } from "#/server/module-fns";
import type { Step } from "#/server/modules";

type Draft<K extends StepKind> = { title: string; content: ContentOf<K> };

// The title is saved trimmed, so a trailing space alone doesn't count as an unsaved change.
const comparable = <K extends StepKind>(draft: Draft<K>) =>
	JSON.stringify({ ...draft, title: draft.title.trim() });

const tab = (on: boolean) =>
	`rounded-md px-2.5 py-1 font-medium ${on ? "bg-muted" : "text-muted-foreground hover:text-foreground"}`;

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
			<div className="mx-auto max-w-3xl px-4 pt-6 md:px-8">
				<EditorBar
					dirty={dirty}
					save={save}
					failed={save.isError || Boolean(props.actionFailed)}
					actions={props.actions}
					left={
						<>
							<button
								type="button"
								aria-pressed={!preview}
								className={tab(!preview)}
								onClick={() => setPreview(false)}
							>
								Tulis
							</button>
							<button
								type="button"
								aria-pressed={preview}
								className={tab(preview)}
								onClick={() => setPreview(true)}
							>
								Pratinjau
							</button>
						</>
					}
				/>
			</div>
			{preview ? (
				<StepArticle
					kind={kind}
					title={draft.title.trim() || "Tanpa judul"}
					content={draft.content}
					dueAt={dueAt}
				/>
			) : (
				<div className="mx-auto grid max-w-3xl gap-5 px-4 pt-3 pb-8 md:px-8">
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
				</div>
			)}
		</form>
	);
}

type StepEditorProps = { userId: string; classId: ClassId; step: Step; dueAt: Date | null };

// Render with key={step.id}, so the form starts from the step it shows.
export function StepEditor({ userId, step, dueAt }: StepEditorProps) {
	const queryClient = useQueryClient();
	return (
		<StepForm
			kind={step.kind}
			initial={{ title: step.title, content: step.content }}
			dueAt={dueAt}
			// The kind never changes, so the step's own kind goes with every save.
			onSave={async (draft) => {
				orThrow(
					await updateStepFn({ data: { stepId: step.id, step: { kind: step.kind, ...draft } } }),
				);
				await Promise.all([
					queryClient.invalidateQueries({ queryKey: ["modules"] }),
					queryClient.invalidateQueries({ queryKey: ["step", userId, step.id] }),
				]);
			}}
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
