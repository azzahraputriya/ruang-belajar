// Owns: the guard for pages that need a signed-in user, and the shell around them (class rail plus page area). Not here: the pages themselves (src/routes/_app/) or the rail's parts (src/components/).

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ClassRail } from "#/components/class-rail";
import { InviteFocusProvider } from "#/components/invite-banner";
import { myClassesQuery, myInvitesQuery } from "#/server/class-fns";
import { sessionQuery } from "#/server/session-fn";

export const Route = createFileRoute("/_app")({
	beforeLoad: async ({ context }) => {
		const user = await context.queryClient.fetchQuery(sessionQuery);
		if (!user) throw redirect({ to: "/masuk" });
		return { user };
	},
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(myClassesQuery),
			context.queryClient.ensureQueryData(myInvitesQuery),
		]),
	component: AppShell,
});

function AppShell() {
	const { user } = Route.useRouteContext();
	return (
		<InviteFocusProvider>
			<div className="flex min-h-svh">
				<ClassRail user={user} />
				<main className="min-w-0 flex-1">
					<Outlet />
				</main>
			</div>
		</InviteFocusProvider>
	);
}
