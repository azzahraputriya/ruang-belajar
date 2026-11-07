// Owns: the split-screen layout for the sign-in and sign-up pages, and sending signed-in users away from them. Not here: the forms (src/routes/_auth/).

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { sessionQuery } from "#/server/session-fn";

export const Route = createFileRoute("/_auth")({
	beforeLoad: async ({ context }) => {
		if (await context.queryClient.ensureQueryData(sessionQuery)) throw redirect({ to: "/" });
	},
	component: AuthLayout,
});

// On phones the blue panel shrinks to a short band, so the form fits without scrolling.
function AuthLayout() {
	return (
		<main className="grid min-h-svh grid-rows-[auto_1fr] md:grid-cols-2 md:grid-rows-1">
			<section className="flex flex-col justify-between gap-4 bg-primary px-6 py-5 text-primary-foreground md:gap-8 md:p-10">
				<span className="inline-flex items-center gap-2 font-semibold">
					<span
						aria-hidden="true"
						className="grid size-6 place-items-center rounded-md bg-primary-foreground text-xs text-primary"
					>
						R
					</span>
					Ruang Belajar
				</span>
				<p className="max-w-sm text-lg leading-snug font-semibold tracking-tight text-pretty md:text-4xl md:leading-tight">
					Belajar di kelasmu, dibantu tutor yang tidak memberi jawaban.
				</p>
				<p className="hidden text-sm opacity-80 md:block">Hanya untuk kelas undangan.</p>
			</section>
			<section className="flex justify-center px-6 py-8 md:items-center md:p-10">
				<div className="grid w-full max-w-sm content-start gap-6">
					<Outlet />
				</div>
			</section>
		</main>
	);
}
