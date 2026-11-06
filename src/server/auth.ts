// Owns: the better-auth server setup and the sign-up rules (username, name, password, the placeholder email). Not here: the HTTP route (src/routes/api/auth/$.ts) or browser code (src/lib/auth-client.ts).

import { type } from "arktype";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "#/db/client";
import * as schema from "#/db/schema";
import { env } from "#/env";

// Accepts any case and stores lowercase, so "Budi" and "budi" are the same account.
const Username = type("string.lower")
	.to(/^[a-z0-9_.]{3,30}$/)
	.describe("3 to 30 letters, digits, _ or .");

const Name = type("string.trim").to("1 <= string <= 80");
const PASSWORD = { min: 8, max: 128 };

const Password = type("string").atLeastLength(PASSWORD.min).atMostLength(PASSWORD.max);

export const SignUpInput = type({ username: Username, name: Name, password: Password });
export type SignUpInput = typeof SignUpInput.inferIn;

// better-auth needs an email on every user. This one can never receive mail.
export const emailForUsername = (name: string) => `${name}@users.ruang-belajar.invalid`;

// Raw requests to the public auth route. Extra keys are refused, so nobody can set fields like `image` or `displayUsername`.
// They must arrive already trimmed, because better-auth stores the raw body, not our parsed copy.
const RawName = type("1 <= string <= 80").narrow(
	(name, ctx) => name === name.trim() || ctx.mustBe("trimmed"),
);
const SignUpBody = type({
	username: Username,
	name: RawName,
	password: Password,
	email: "string",
}).onUndeclaredKey("reject");
const UpdateUserBody = type({ "name?": RawName }).onUndeclaredKey("reject");

// The username is part of the placeholder email, so changing either would split them. Neither can change.
const BLOCKED_PATHS = new Set(["/change-email", "/update-username"]);

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: "pg", schema }),
	emailAndPassword: {
		enabled: true,
		minPasswordLength: PASSWORD.min,
		maxPasswordLength: PASSWORD.max,
	},
	hooks: {
		// The auth route is public, so a raw POST to /sign-up/email gets the same rules as signUp() below.
		before: createAuthMiddleware(async (ctx) => {
			if (BLOCKED_PATHS.has(ctx.path)) throw new APIError("FORBIDDEN");
			if (ctx.path === "/update-user") {
				const body = UpdateUserBody(ctx.body);
				if (body instanceof type.errors)
					throw new APIError("BAD_REQUEST", { message: body.summary });
				return;
			}
			if (ctx.path !== "/sign-up/email") return;
			const body = SignUpBody(ctx.body);
			if (body instanceof type.errors) throw new APIError("BAD_REQUEST", { message: body.summary });
			// A fixed message, because echoing the body would leak the password.
			if (body.email !== emailForUsername(body.username)) {
				throw new APIError("BAD_REQUEST", { message: "email must be the placeholder email" });
			}
		}),
	},
	plugins: [username(), tanstackStartCookies()],
});

// The only sign-up the app calls. The client never sends an email.
// Returns the response headers so callers can pass the session cookie on.
export async function signUp(input: SignUpInput) {
	const { username: name, ...rest } = SignUpInput.assert(input);
	return auth.api.signUpEmail({
		body: { ...rest, username: name, email: emailForUsername(name) },
		returnHeaders: true,
	});
}
