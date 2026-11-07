// Owns: the short message a class pane shows when it has nothing else, such as no modules or a missing step. Not here: the panes themselves (src/routes/_app/kelas/$classId/).

export function PaneMessage({ title, children }: { title: string; children?: React.ReactNode }) {
	return (
		<div className="grid justify-items-start gap-3 px-4 py-8 md:px-8">
			<p className="font-medium">{title}</p>
			{children}
		</div>
	);
}
