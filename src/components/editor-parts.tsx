// Owns: the pieces the step and module editors share: the top bar with save state, Simpan, and the error line. Not here: the editors' fields and saving (src/components/step-form.tsx, src/components/module-form.tsx).

import { useEffect } from "react";
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
