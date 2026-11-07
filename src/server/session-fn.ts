// Owns: reading the signed-in user from the request's session cookie, and the query that caches it in the browser. Not here: route guards (src/routes/_app.tsx, src/routes/_auth.tsx).

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "#/server/auth";

export const getSessionUserFn = createServerFn({ method: "GET" }).handler(async () => {
	const session = await auth.api.getSession({ headers: getRequestHeaders() });
	if (!session) return null;
	const { id, username, name } = session.user;
	return { id, username, name };
});

// Never fresh (the default staleTime of 0), so each guard's fetchQuery asks the server again.
// One request per page change, but sign-in, sign-out, or another tab can never leave a guard trusting an old answer.
export const sessionQuery = queryOptions({
	queryKey: ["session"],
	queryFn: () => getSessionUserFn(),
});
