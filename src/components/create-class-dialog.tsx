// Owns: the "Buat kelas" dialog, its form, and opening the new class. Not here: the trigger buttons (whoever renders this) or the class rules (src/server/classes.ts).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type } from "arktype";
import { useState } from "react";
import { flushSync } from "react-dom";
import { FormField } from "#/components/form-field";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { createClassFn } from "#/server/class-fns";

const ClassForm = type({ title: "string", subject: "string" });
type Field = keyof typeof ClassForm.infer;

const EMPTY: Record<Field, string> = {
	title: "Isi nama kelas.",
	subject: "Isi mata pelajaran.",
};

// `trigger` is one button, so the rail's "+" and the empty state's button each open their own copy.
export function CreateClassDialog({ trigger }: { trigger: React.ReactElement }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});

	const create = useMutation({
		mutationFn: (input: Record<Field, string>) => createClassFn({ data: input }),
		onSuccess: async ({ class: created }) => {
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			setOpen(false);
			await navigate({ to: "/kelas/$classId", params: { classId: created.id } });
		},
	});

	function onOpenChange(next: boolean) {
		setOpen(next);
		if (!next) {
			setFieldErrors({});
			create.reset();
		}
	}

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const raw = ClassForm.assert(Object.fromEntries(new FormData(form)));
		const input = { title: raw.title.trim(), subject: raw.subject.trim() };
		const errors: Partial<Record<Field, string>> = {};
		if (!input.title) errors.title = EMPTY.title;
		if (!input.subject) errors.subject = EMPTY.subject;
		// Render the errors before moving focus, so a screen reader reads the field with its error.
		flushSync(() => setFieldErrors(errors));
		const first = Object.keys(errors)[0];
		if (first) {
			const field = form.elements.namedItem(first);
			if (field instanceof HTMLElement) field.focus();
			return;
		}
		create.mutate(input);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			{/* No description: the two labelled fields say everything. */}
			<DialogContent showCloseButton={false} aria-describedby={undefined}>
				<DialogTitle>Buat kelas</DialogTitle>
				<form method="post" className="grid gap-4" noValidate onSubmit={onSubmit}>
					<FormField
						id="title"
						label="Nama kelas"
						placeholder="Fisika XI IPA 2"
						maxLength={100}
						autoComplete="off"
						error={fieldErrors.title}
					/>
					<FormField
						id="subject"
						label="Mata pelajaran"
						placeholder="Fisika"
						maxLength={60}
						autoComplete="off"
						error={fieldErrors.subject}
					/>
					<div>
						<div role="alert">
							{create.isError ? (
								<p className="pb-4 text-sm text-destructive">
									Tidak bisa membuat kelas sekarang. Coba lagi.
								</p>
							) : null}
						</div>
						<div className="flex justify-end gap-2">
							<DialogClose asChild>
								<Button type="button" variant="ghost">
									Batal
								</Button>
							</DialogClose>
							<Button type="submit" disabled={create.isPending}>
								{create.isPending ? "Memproses…" : "Buat kelas"}
							</Button>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
