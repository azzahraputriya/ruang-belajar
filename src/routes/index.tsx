// Owns: the home page at "/". Placeholder until the class switcher replaces it in phase 3.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-semibold tracking-tight">Ruang Belajar</h1>
			<p className="text-muted-foreground">Kelas, materi, dan tutor AI dalam satu tempat.</p>
		</main>
	);
}
