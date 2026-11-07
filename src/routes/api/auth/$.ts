// Owns: the HTTP endpoint for every better-auth request under /api/auth. Not here: auth settings and sign-up rules (src/server/auth.ts).

import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/server/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => auth.handler(request),
			POST: ({ request }) => auth.handler(request),
		},
	},
});
