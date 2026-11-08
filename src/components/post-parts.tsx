// Owns: the pieces discussion posts and announcements share: the author line, the "⋯" menu with its delete confirm, and the write box used to post, reply, and edit. Not here: a discussion thread (src/components/discussion-thread.tsx) or the announcement list (src/components/announcements.tsx).

import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Textarea } from "#/components/ui/textarea";
import { refusalMessage } from "#/lib/refused";
import { formatDayTime } from "#/lib/wib";

// Same limit as the server's PostInput and AnnouncementInput.
const BODY_MAX = 10_000;

export function Byline({
	name,
	mine,
	teacher = false,
	createdAt,
	editedAt,
	className = "",
}: {
	name: string;
	mine: boolean;
	teacher?: boolean;
	createdAt: Date;
	editedAt: Date | null;
	className?: string;
}) {
	return (
		<p className={`flex flex-wrap items-baseline gap-x-1.5 text-sm ${className}`}>
			<span className="font-medium">{mine ? `${name} (kamu)` : name}</span>
			{teacher ? <span className="text-xs text-primary">Guru</span> : null}
			<span className="text-xs text-muted-foreground">
				{formatDayTime(createdAt)}
				{editedAt ? " · diedit" : ""}
			</span>
		</p>
	);
}

// Nothing renders when there is nothing to offer, so callers pass the rules and not a guard.
export function ItemMenu({
	what,
	label,
	consequence,
	onEdit,
	onDelete,
}: {
	what: string;
	// Whose item this is, for the screen reader name of the button.
	label: string;
	consequence: string;
	onEdit?: (() => void) | undefined;
	onDelete?: (() => void) | undefined;
}) {
	const [confirming, setConfirming] = useState(false);
	if (!onEdit && !onDelete) return null;
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						aria-label={`Pilihan untuk ${what} ${label}`}
						className="text-muted-foreground"
					>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{onEdit ? <DropdownMenuItem onSelect={onEdit}>Ubah</DropdownMenuItem> : null}
					{onDelete ? (
						<DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
							Hapus
						</DropdownMenuItem>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			{/* Opened from state, not a trigger, because the menu closes before the dialog opens. */}
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Hapus {what} ini?</AlertDialogTitle>
						<AlertDialogDescription>{consequence}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Batal</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={onDelete}>
							Hapus
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

// A textarea with its send button. Clears after a save, unless `onCancel` is given: then it is an
// edit or a reply box, and the caller closes it in `onDone`.
export function WriteBox({
	label,
	placeholder,
	submitLabel,
	initial = "",
	minHeight = "min-h-24",
	focusOnOpen = false,
	save,
	refused,
	onDone,
	onCancel,
}: {
	label: string;
	placeholder?: string;
	submitLabel: string;
	initial?: string;
	minHeight?: string;
	// Only for boxes the person just opened with a click.
	focusOnOpen?: boolean;
	save: (body: string) => Promise<unknown>;
	refused: Partial<Record<string, string>>;
	onDone?: () => void;
	onCancel?: () => void;
}) {
	const [text, setText] = useState(initial);
	const send = useMutation({
		mutationFn: save,
		onSuccess: () => {
			if (!onCancel) setText("");
			onDone?.();
		},
	});
	const empty = text.trim() === "";
	return (
		<form
			className="grid gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (!empty) send.mutate(text);
			}}
		>
			<Textarea
				aria-label={label}
				placeholder={placeholder}
				maxLength={BODY_MAX}
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- only boxes the person just opened with a click.
				autoFocus={focusOnOpen}
				className={minHeight}
				value={text}
				onChange={(e) => setText(e.target.value)}
			/>
			<div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
				<p role="alert" className="mr-auto text-sm text-destructive empty:hidden">
					{refusalMessage(send.error, refused, "Tidak bisa menyimpan. Coba lagi.")}
				</p>
				{onCancel ? (
					<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
						Batal
					</Button>
				) : null}
				<Button type="submit" size="sm" disabled={empty || send.isPending}>
					{submitLabel}
				</Button>
			</div>
		</form>
	);
}
