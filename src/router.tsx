// Owns: creating the app router with its QueryClient, and registering its type with TanStack Router. Not here: routes (src/routes/).

import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	// One client per router. The server builds a router per request, so a shared client would leak one person's data into another's page.
	const queryClient = new QueryClient();
	const router = createTanStackRouter({
		routeTree,
		context: { queryClient },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});
	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack type registration needs interface merging
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
