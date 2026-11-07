// Owns: the left rail of class tiles, invite tiles, the "+" button, and sign-out. Not here: the invite banner (src/components/invite-banner.tsx) or the create dialog (src/components/create-class-dialog.tsx).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Plus } from "lucide-react";
import { CreateClassDialog } from "#/components/create-class-dialog";
import { useShowInvite } from "#/components/invite-banner";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { initials } from "#/lib/class-labels";
import { myClassesQuery, myInvitesQuery } from "#/server/class-fns";

const TILE =
	"grid size-10 place-items-center rounded-md text-sm font-semibold text-primary outline-ring focus-visible:outline-2 focus-visible:outline-offset-2";

const SIGN_OUT_FAILED = "Tidak bisa keluar sekarang. Coba lagi.";

export function ClassRail({ user }: { user: { id: string; name: string } }) {
	const { data: classes } = useSuspenseQuery(myClassesQuery(user.id));
	const { data: invites } = useSuspenseQuery(myInvitesQuery(user.id));
	const showInvite = useShowInvite();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const signOut = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.signOut();
			if (error) throw new Error(`Sign-out failed with status ${error.status}`);
		},
		// Leave first, so the rail unmounts before its queries are dropped and can't refetch without a session.
		onSuccess: async () => {
			await navigate({ to: "/masuk" });
			queryClient.clear();
		},
	});

	return (
		<nav
			aria-label="Kelas"
			className="sticky top-0 flex h-svh w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r bg-muted/40 py-3"
		>
			{classes.map((c) => (
				<Link
					key={c.id}
					to="/kelas/$classId"
					params={{ classId: c.id }}
					aria-label={c.title}
					title={c.title}
					className={`${TILE} bg-primary/10`}
					activeProps={{ className: "ring-2 ring-primary ring-offset-2 ring-offset-background" }}
				>
					{initials(c.title)}
				</Link>
			))}
			{classes.length > 0 && invites.length > 0 ? (
				<div aria-hidden="true" className="my-1 h-px w-8 shrink-0 bg-border" />
			) : null}
			{invites.map((i) => (
				<button
					key={i.id}
					type="button"
					aria-label={`Undangan: ${i.classTitle}`}
					title={`Undangan: ${i.classTitle}`}
					onClick={() => showInvite(i.id)}
					className={`${TILE} relative shrink-0 border border-dashed border-primary/70`}
				>
					<span className="opacity-70">{initials(i.classTitle)}</span>
					<span
						aria-hidden="true"
						className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-background"
					/>
				</button>
			))}
			<CreateClassDialog
				trigger={
					<Button
						size="icon"
						variant="ghost"
						className="size-10 shrink-0"
						aria-label="Buat kelas"
						title="Buat kelas"
					>
						<Plus />
					</Button>
				}
			/>
			<div className="mt-auto grid shrink-0 justify-items-center gap-2 pt-2">
				<span
					aria-hidden="true"
					title={user.name}
					className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
				>
					{initials(user.name)}
				</span>
				{/* The rail has no room for a visible line, so a failed sign-out is announced and shown in the tooltip. */}
				<span role="alert" className="sr-only">
					{signOut.isError ? SIGN_OUT_FAILED : ""}
				</span>
				<Button
					size="icon"
					variant="ghost"
					className="size-10"
					aria-label="Keluar"
					title={signOut.isError ? SIGN_OUT_FAILED : "Keluar"}
					disabled={signOut.isPending}
					onClick={() => signOut.mutate()}
				>
					<LogOut />
				</Button>
			</div>
		</nav>
	);
}
