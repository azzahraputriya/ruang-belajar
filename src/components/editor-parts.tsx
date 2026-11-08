// Owns: the pieces the step and module editors share: the top bar with save state, Simpan, and the error line, the move buttons, the delete confirm, and the unsaved-changes guard and dialog. Not here: the editors' fields and saving (src/components/step-form.tsx, src/components/module-form.tsx).

import { useBlocker } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useEffect } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { refusalMessage } from "#/lib/refused";
import type {
	createModuleFn,
	createStepFn,
	deleteModuleFn,
	deleteStepFn,
	reorderModulesFn,
	reorderStepsFn,
	updateModuleFn,
	updateStepFn,
} from "#/server/module-fns";

type SaveState = { isPending: boolean; isSuccess: boolean; reset: () => void };

type EditorBarProps = {
	left: React.ReactNode;
	dirty: boolean;
	save: SaveState;
	saveError: Error | null;
	// A move or delete from the same pane failed.
	actionError: Error | null;
	actions?: React.ReactNode;
};

type EditRefusal = Extract<
	Awaited<
		ReturnType<
			| typeof createModuleFn
			| typeof updateModuleFn
			| typeof deleteModuleFn
			| typeof reorderModulesFn
			| typeof createStepFn
			| typeof updateStepFn
			| typeof deleteStepFn
			| typeof reorderStepsFn
		>
	>,
	{ ok: false }
>["reason"];
// Every reason a module or step change can be refused with. A new reason fails to compile until it has a message.
const REFUSED: Record<EditRefusal, string> = {
	not_found: "Sudah tidak ada. Muat ulang halaman.",
	forbidden: "Hanya guru yang bisa mengubah ini.",
	ids_mismatch: "Urutannya berubah di tempat lain. Muat ulang halaman.",
	kind_changed: "Jenis langkah tidak bisa diubah.",
};

// Sits inside the editor's <form>, so Simpan submits it.
// A failed save is worth retrying. A failed move or delete usually means the list changed
// elsewhere, so it asks for a reload instead.
function errorLine(saveError: Error | null, actionError: Error | null) {
	if (saveError) return refusalMessage(saveError, REFUSED, "Tidak bisa menyimpan. Coba lagi.");
	if (actionError) {
		return refusalMessage(
			actionError,
			REFUSED,
			"Tidak berhasil. Muat ulang halaman, lalu coba lagi.",
		);
	}
	return undefined;
}

// A step draft as compared for "unsaved". The title is saved trimmed, so a trailing space alone doesn't count.
export const comparableStep = (draft: { title: string; content: unknown }) =>
	JSON.stringify({ ...draft, title: draft.title.trim() });

export function EditorBar({ left, dirty, save, saveError, actionError, actions }: EditorBarProps) {
	const error = errorLine(saveError, actionError);
	const { isSuccess, reset } = save;
	// "Tersimpan" shows briefly, then the bar goes quiet again.
	useEffect(() => {
		const timer = isSuccess ? setTimeout(reset, 2000) : undefined;
		return () => clearTimeout(timer);
	}, [isSuccess, reset]);

	let state = "";
	if (dirty) state = "Belum disimpan";
	else if (isSuccess) state = "Tersimpan";

	return (
		<div className="grid gap-2">
			<div className="flex flex-wrap items-center gap-1 text-sm">
				{left}
				<output className="ml-auto px-1 text-xs text-muted-foreground">{state}</output>
				{actions}
				<Button type="submit" size="sm" className="ml-1" disabled={save.isPending}>
					{save.isPending ? "Menyimpan…" : "Simpan"}
				</Button>
			</div>
			<div role="alert">{error ? <p className="text-sm text-destructive">{error}</p> : null}</div>
		</div>
	);
}

// `ids` is every sibling in its current order. `onMove` gets them all in the new order, which is
// what the reorder server functions expect.
export function MoveButtons<Id extends string>({
	ids,
	id,
	what,
	pending,
	onMove,
}: {
	ids: readonly Id[];
	id: Id;
	what: string;
	pending: boolean;
	onMove: (orderedIds: Id[]) => void;
}) {
	const at = ids.indexOf(id);
	const moveBy = (delta: number) => {
		const next = [...ids];
		next.splice(at, 1);
		next.splice(at + delta, 0, id);
		onMove(next);
	};
	return (
		<>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				aria-label={`Naikkan ${what}`}
				title={`Naikkan ${what}`}
				disabled={pending || at <= 0}
				onClick={() => moveBy(-1)}
			>
				<ArrowUp />
			</Button>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				aria-label={`Turunkan ${what}`}
				title={`Turunkan ${what}`}
				disabled={pending || at === -1 || at >= ids.length - 1}
				onClick={() => moveBy(1)}
			>
				<ArrowDown />
			</Button>
		</>
	);
}

export function DeleteButton({
	what,
	consequence,
	pending,
	onConfirm,
}: {
	what: string;
	consequence: string;
	pending: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					size="icon-sm"
					variant="ghost"
					aria-label={`Hapus ${what}`}
					title={`Hapus ${what}`}
					disabled={pending}
				>
					<Trash2 />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Hapus {what} ini?</AlertDialogTitle>
					<AlertDialogDescription>{consequence}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Batal</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onConfirm}>
						Hapus
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

const always = () => true;

// "Leave without saving?" Shared by the route guard below and by editors that switch what they show
// in place, like the quiz editor's question list.
export function DiscardDialog({
	open,
	onStay,
	onLeave,
}: {
	open: boolean;
	onStay: () => void;
	onLeave: () => void;
}) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onStay();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Tinggalkan tanpa menyimpan?</AlertDialogTitle>
					<AlertDialogDescription>
						Perubahan yang belum disimpan akan hilang.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Tetap di sini</AlertDialogCancel>
					<AlertDialogAction variant="destructive" onClick={onLeave}>
						Tinggalkan
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// While the form has unsaved edits, leaving the page asks first: links and Back get this dialog,
// closing or reloading the tab gets the browser's own prompt. Navigations that follow a save pass
// `ignoreBlocker`.
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
	const blocker = useBlocker({
		shouldBlockFn: always,
		disabled: !dirty,
		enableBeforeUnload: true,
		withResolver: true,
	});
	return (
		<DiscardDialog
			open={blocker.status === "blocked"}
			onStay={() => blocker.reset?.()}
			onLeave={() => blocker.proceed?.()}
		/>
	);
}
