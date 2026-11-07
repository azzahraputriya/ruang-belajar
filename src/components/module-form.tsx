// Owns: the teacher's module editor (title, opens at, due at, client checks) and the wiring that creates, updates, moves, or deletes a module through it. Not here: the module rules (src/server/modules.ts) or WIB conversion (src/lib/wib.ts).

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
import type { FieldErrors } from "#/components/step-kinds-ui";
import type { ClassId, ModuleId } from "#/db/ids";
import { fromWibInput, toWibInput } from "#/lib/wib";
import {
	type ModuleWithSteps,
	createModuleFn,
	deleteModuleFn,
	orThrow,
	reorderModulesFn,
	updateModuleFn,
} from "#/server/module-fns";

// Dates stay as the inputs' "YYYY-MM-DDTHH:mm" strings while editing, "" meaning none.
type Draft = { title: string; opensAt: string; dueAt: string };

// Every save sends all three fields: the server reads a missing date as "clear it".
const toInput = (draft: Draft) => ({
	title: draft.title.trim(),
	opensAt: fromWibInput(draft.opensAt),
	dueAt: fromWibInput(draft.dueAt),
});
type ModuleValue = ReturnType<typeof toInput>;

const comparable = (draft: Draft) => JSON.stringify({ ...draft, title: draft.title.trim() });

// The server's validator throws on these instead of answering, so they're caught here first.
function moduleErrors(value: ModuleValue): FieldErrors {
	const errors: FieldErrors = {};
	if (!value.title) errors.title = "Isi judul modul.";
	if (value.opensAt && value.dueAt && value.dueAt < value.opensAt) {
		errors.dueAt = "Tenggat tidak boleh sebelum modul dibuka.";
	}
	return errors;
}

type ModuleFormProps = {
	heading: string;
	initial: Draft;
	// Throws when the server says no.
	onSave: (value: ModuleValue) => Promise<void>;
	actions?: React.ReactNode;
	actionError?: Error | null;
};

function ModuleForm({ heading, initial, onSave, actions, actionError }: ModuleFormProps) {
	const [draft, setDraft] = useState(initial);
	const [saved, setSaved] = useState(initial);
	const [errors, setErrors] = useState<FieldErrors>({});
	const dirty = comparable(draft) !== comparable(saved);

	const save = useMutation({
		mutationFn: (submitted: Draft) => onSave(toInput(submitted)),
		onSuccess: (_, submitted) => setSaved(submitted),
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const found = moduleErrors(toInput(draft));
		// Render the errors before moving focus, so a screen reader reads the field with its error.
		flushSync(() => setErrors(found));
		const first = Object.keys(found)[0];
		if (first) {
			const field = form.elements.namedItem(first);
			if (field instanceof HTMLElement) field.focus();
			return;
		}
		save.mutate(draft);
	}

	const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
		setDraft({ ...draft, [key]: e.target.value });

	return (
		<form
			method="post"
			noValidate
			onSubmit={onSubmit}
			className="mx-auto grid max-w-3xl gap-5 px-4 py-6 md:px-8"
		>
			<UnsavedChangesGuard dirty={dirty} />
			<EditorBar
				dirty={dirty}
				save={save}
				saveError={save.error}
				actionError={actionError ?? null}
				actions={actions}
				left={<h2 className="px-1 font-medium">{heading}</h2>}
			/>
			<FormField
				id="title"
				label="Judul"
				placeholder="Gerak lurus"
				maxLength={200}
				autoComplete="off"
				error={errors.title}
				value={draft.title}
				onChange={set("title")}
			/>
			<div className="grid gap-5 sm:grid-cols-2">
				<FormField
					id="opensAt"
					label="Dibuka"
					type="datetime-local"
					hint="WIB. Kosongkan agar langsung terbuka."
					error={errors.opensAt}
					value={draft.opensAt}
					onChange={set("opensAt")}
				/>
				<FormField
					id="dueAt"
					label="Tenggat"
					type="datetime-local"
					hint="WIB. Boleh kosong."
					error={errors.dueAt}
					value={draft.dueAt}
					onChange={set("dueAt")}
				/>
			</div>
		</form>
	);
}

// Saving creates the module and opens its pane, where steps get added from the syllabus.
export function NewModule({ classId }: { classId: ClassId }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	return (
		<ModuleForm
			heading="Modul baru"
			initial={{ title: "", opensAt: "", dueAt: "" }}
			onSave={async (value) => {
				const { module } = orThrow(await createModuleFn({ data: { classId, module: value } }));
				await queryClient.invalidateQueries({ queryKey: ["modules"] });
				await navigate({
					to: "/kelas/$classId/modul/$moduleId",
					params: { classId, moduleId: module.id },
					ignoreBlocker: true,
				});
			}}
		/>
	);
}

type ModuleEditorProps = {
	classId: ClassId;
	module: ModuleWithSteps;
	// Every module of the class, in order, for moving and numbering.
	modules: readonly ModuleWithSteps[];
};

// Render with key={module.id}, so the form starts from the module it shows.
// The module pane watches this, so its own delete doesn't flash "not found" on the way out.
export const deletingModuleKey = (moduleId: ModuleId) => ["delete-module", moduleId] as const;

export function ModuleEditor({ classId, module, modules }: ModuleEditorProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const ids = modules.map((m) => m.id);

	// Settled either way: a refetch shows the real order, and an ids_mismatch is not retried.
	const move = useMutation({
		mutationFn: async (orderedIds: ModuleId[]) =>
			orThrow(await reorderModulesFn({ data: { classId, orderedIds } })),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["modules"] }),
	});

	// The syllabus refetches before leaving, so the class index can't resume inside this module.
	const remove = useMutation({
		mutationKey: deletingModuleKey(module.id),
		mutationFn: async () => orThrow(await deleteModuleFn({ data: { moduleId: module.id } })),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["modules"] });
			await navigate({ to: "/kelas/$classId", params: { classId }, ignoreBlocker: true });
		},
	});

	return (
		<ModuleForm
			heading={`Modul ${ids.indexOf(module.id) + 1}`}
			initial={{
				title: module.title,
				opensAt: toWibInput(module.opensAt),
				dueAt: toWibInput(module.dueAt),
			}}
			onSave={async (value) => {
				// A new save replaces any earlier move or delete error in the bar.
				move.reset();
				remove.reset();
				orThrow(await updateModuleFn({ data: { moduleId: module.id, module: value } }));
				await queryClient.invalidateQueries({ queryKey: ["modules"] });
			}}
			actionError={move.error ?? remove.error}
			actions={
				<>
					<MoveButtons
						ids={ids}
						id={module.id}
						what="modul"
						pending={move.isPending}
						onMove={(orderedIds) => move.mutate(orderedIds)}
					/>
					<DeleteButton
						what="modul"
						consequence={`Semua langkahnya (${module.steps.length}) dan catatan baca siswa ikut terhapus.`}
						pending={remove.isPending}
						onConfirm={() => remove.mutate()}
					/>
				</>
			}
		/>
	);
}
