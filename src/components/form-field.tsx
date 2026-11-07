// Owns: one labelled form input or textarea with its hint and error, wired for screen readers. Not here: form state or validation (the page that uses it).

import type * as React from "react";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";

type Labelled = { id: string; label: string; hint?: string; error?: string };

// The error replaces the hint, so the field never grows by two lines at once.
const noteOf = ({ hint, error }: Labelled) => error ?? hint;

const controlProps = (field: Labelled) => ({
	id: field.id,
	name: field.id,
	"aria-invalid": field.error ? true : undefined,
	"aria-describedby": noteOf(field) ? `${field.id}-note` : undefined,
});

function Field({ field, children }: { field: Labelled; children: React.ReactNode }) {
	const note = noteOf(field);
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={field.id}>{field.label}</Label>
			{children}
			{note ? (
				<p
					id={`${field.id}-note`}
					className={field.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
				>
					{note}
				</p>
			) : null}
		</div>
	);
}

export function FormField({
	id,
	label,
	hint,
	error,
	...inputProps
}: React.ComponentProps<typeof Input> & Labelled) {
	const field = { id, label, hint, error };
	return (
		<Field field={field}>
			<Input {...controlProps(field)} {...inputProps} />
		</Field>
	);
}

export function TextareaField({
	id,
	label,
	hint,
	error,
	...textareaProps
}: React.ComponentProps<typeof Textarea> & Labelled) {
	const field = { id, label, hint, error };
	return (
		<Field field={field}>
			<Textarea {...controlProps(field)} {...textareaProps} />
		</Field>
	);
}
