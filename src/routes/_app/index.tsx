// Owns: the home page at "/" for a signed-in user, with sign-out. Placeholder until the class switcher replaces it in phase 3. Not here: the signed-in guard (src/routes/_app.tsx).

import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/_app/")({ component: Home });

function Home() {
	const { user } = Route.useRouteContext();
	const navigate = useNavigate();
	const signOut = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.signOut();
			if (error) throw new Error(`Sign-out failed with status ${error.status}`);
		},
		onSuccess: async () => {
			await navigate({ to: "/masuk" });
		},
	});

	return (
		<main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
			<h1 className="text-2xl font-semibold tracking-tight">Halo, {user.name}</h1>
			<div>
				<div role="alert">
					{signOut.isError ? (
						<p className="pb-3 text-sm text-destructive">Tidak bisa keluar sekarang. Coba lagi.</p>
					) : null}
				</div>
				<Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
					{signOut.isPending ? "Memproses…" : "Keluar"}
				</Button>
			</div>
		</main>
	);
}
