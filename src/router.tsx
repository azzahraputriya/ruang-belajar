// Owns: creating the app router and registering its type with TanStack Router. Not here: routes (src/routes/).

import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});

	return router;
}

declare module "@tanstack/react-router" {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack type registration needs interface merging
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
