// Owns: the sign-up server function the sign-up screen calls. Not here: the sign-up rules themselves (src/server/auth.ts).

import { createServerFn } from "@tanstack/react-start";
import { SignUpInput, signUp } from "#/server/auth";

// The session cookie reaches the browser through better-auth's tanstackStartCookies plugin.
export const signUpFn = createServerFn({ method: "POST" })
	.validator(SignUpInput)
	.handler(async ({ data }) => {
		const { response } = await signUp(data);
		return { user: { id: response.user.id, name: response.user.name } };
	});
