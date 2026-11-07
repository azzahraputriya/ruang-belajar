// Owns: the guard for pages that need a signed-in user, which passes that user to its child routes. Not here: the pages themselves (src/routes/_app/).

import { createFileRoute, redirect } from "@tanstack/react-router";
import { sessionQuery } from "#/server/session-fn";

export const Route = createFileRoute("/_app")({
	beforeLoad: async ({ context }) => {
		const user = await context.queryClient.ensureQueryData(sessionQuery);
		if (!user) throw redirect({ to: "/masuk" });
		return { user };
	},
});
