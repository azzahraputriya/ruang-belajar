// Owns: the pieces the step and module editors share: the top bar with save state, Simpan, and the error line, the move buttons, the delete confirm, and the unsaved-changes guard. Not here: the editors' fields and saving (src/components/step-form.tsx, src/components/module-form.tsx).

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

type SaveState = { isPending: boolean; isSuccess: boolean; reset: () => void };

type EditorBarProps = {
	left: React.ReactNode;
	dirty: boolean;
	save: SaveState;
	// Any write from this pane failed: save, move, or delete.
	failed: boolean;
	actions?: React.ReactNode;
};

// Sits inside the editor's <form>, so Simpan submits it.
export function EditorBar({ left, dirty, save, failed, actions }: EditorBarProps) {
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
			<div role="alert">
				{failed ? (
					<p className="text-sm text-destructive">Tidak bisa menyimpan. Coba lagi.</p>
				) : null}
			</div>
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
		<AlertDialog
			open={blocker.status === "blocked"}
			onOpenChange={(open) => {
				if (!open) blocker.reset?.();
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
					<AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
						Tinggalkan
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
