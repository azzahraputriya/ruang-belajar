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

export const SignUpInput = type({
	username: Username,
	name: type("string.trim").to("1 <= string <= 80"),
	password: "8 <= string <= 128",
});
export type SignUpInput = typeof SignUpInput.inferIn;

// better-auth needs an email on every user. This one can never receive mail.
export const emailForUsername = (name: string) => `${name}@users.ruang-belajar.invalid`;

const SignUpBody = SignUpInput.and({ email: "string" });

export const auth = betterAuth({
	baseURL: env.BETTER_AUTH_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: "pg", schema }),
	emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
	hooks: {
		// The auth route is public, so a raw POST to /sign-up/email gets the same rules as signUp() below.
		before: createAuthMiddleware(async (ctx) => {
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
