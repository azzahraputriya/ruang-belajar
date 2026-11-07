// Owns: reading the signed-in user from the request's session cookie, and the query that caches it in the browser. Not here: route guards (src/routes/_app.tsx, src/routes/_auth.tsx).

import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "#/server/auth";

export const getSessionUserFn = createServerFn({ method: "GET" }).handler(async () => {
	const session = await auth.api.getSession({ headers: getRequestHeaders() });
	if (!session) return null;
	const { id, username, name } = session.user;
	return { id, username, name };
});

export const sessionQuery = queryOptions({
	queryKey: ["session"],
	queryFn: () => getSessionUserFn(),
});

// Guards use ensureQueryData, which keeps a cached user even after the cookie changes.
// So call this after every sign-in, sign-up, and sign-out, before navigating.
export const resetSession = (queryClient: QueryClient) =>
	queryClient.removeQueries({ queryKey: sessionQuery.queryKey });
