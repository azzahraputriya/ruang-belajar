// Owns: one labelled form input with its hint and error, wired for screen readers. Not here: form state or validation (the page that uses it).

import type * as React from "react";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";

type FormFieldProps = React.ComponentProps<typeof Input> & {
	id: string;
	label: string;
	hint?: string;
	error?: string;
};

// The error replaces the hint, so the field never grows by two lines at once.
export function FormField({ id, label, hint, error, ...inputProps }: FormFieldProps) {
	const note = error ?? hint;
	const noteId = note ? `${id}-note` : undefined;
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				name={id}
				aria-invalid={error ? true : undefined}
				aria-describedby={noteId}
				{...inputProps}
			/>
			{note ? (
				<p
					id={noteId}
					className={error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
				>
					{note}
				</p>
			) : null}
		</div>
	);
}
