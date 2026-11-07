// Owns: "/" for a signed-in user, which opens the last or first class, or shows the empty state when there is none. Not here: the shell and guard (src/routes/_app.tsx).

import { createFileRoute, redirect } from "@tanstack/react-router";
import { CreateClassDialog } from "#/components/create-class-dialog";
import { InviteBanner } from "#/components/invite-banner";
import { Button } from "#/components/ui/button";
import { getLastClassFn, myClassesQuery } from "#/server/class-fns";

export const Route = createFileRoute("/_app/")({
	beforeLoad: async ({ context }) => {
		const last = await getLastClassFn();
		const classId = last?.id ?? (await context.queryClient.fetchQuery(myClassesQuery))[0]?.id;
		if (classId) throw redirect({ to: "/kelas/$classId", params: { classId } });
	},
	component: NoClasses,
});

function NoClasses() {
	return (
		<>
			<InviteBanner />
			<div className="grid justify-items-start gap-3 px-4 py-6 sm:px-6">
				<h1 className="font-medium">Belum ada kelas.</h1>
				<CreateClassDialog trigger={<Button>Buat kelas</Button>} />
			</div>
		</>
	);
}
