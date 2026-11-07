// Owns: a form's submit button, its pending state, and the form-level error above it. Not here: field errors (src/components/form-field.tsx).

import { Button } from "#/components/ui/button";

type FormSubmitProps = { label: string; pending: boolean; error: string };

// The alert region stays mounted while empty, so screen readers announce the error when it appears.
export function FormSubmit({ label, pending, error }: FormSubmitProps) {
	return (
		<div>
			<div role="alert">
				{error ? <p className="pb-4 text-sm text-destructive">{error}</p> : null}
			</div>
			<Button type="submit" className="w-full" disabled={pending}>
				{pending ? "Memproses…" : label}
			</Button>
		</div>
	);
}
