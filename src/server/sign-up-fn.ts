// Owns: the sign-up server function the sign-up screen calls. Not here: the sign-up rules themselves (src/lib/sign-up-rules.ts, src/server/auth.ts).

import { createServerFn } from "@tanstack/react-start";
import { APIError } from "better-auth";
import { SignUpInput } from "#/lib/sign-up-rules";
import { signUp } from "#/server/auth";

// The session cookie reaches the browser through better-auth's tanstackStartCookies plugin.
// A taken username comes back as a value, because a thrown better-auth error loses its code on the way to the browser.
export const signUpFn = createServerFn({ method: "POST" })
	.validator(SignUpInput)
	.handler(async ({ data }) => {
		try {
			await signUp(data);
			return { ok: true } as const;
		} catch (error) {
			if (error instanceof APIError && error.body?.code === "USERNAME_IS_ALREADY_TAKEN") {
				return { ok: false, reason: "username-taken" } as const;
			}
			throw error;
		}
	});
