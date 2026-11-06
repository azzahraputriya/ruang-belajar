// Owns: reading and checking server environment variables, once at startup. Not here: anything sent to the browser.

import { type } from "arktype";

const Env = type({
	DATABASE_URL: "string.url",
	BETTER_AUTH_SECRET: "string >= 32",
	BETTER_AUTH_URL: "string.url",
});

export const env = Env.assert(process.env);
