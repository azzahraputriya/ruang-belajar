// Owns: reading and checking server environment variables, once at startup. Not here: anything sent to the browser.

import { type } from "arktype";

const Env = type({
	DATABASE_URL: "string.url",
	BETTER_AUTH_SECRET: "string >= 32",
	BETTER_AUTH_URL: "string.url",
	// Where uploaded files live on disk. Relative paths start from the working directory.
	UPLOAD_DIR: ["string > 0", "=", "./data/uploads"],
});

const parsed = Env(process.env);
// Names only, never values: a malformed DATABASE_URL can still contain the password.
if (parsed instanceof type.errors) {
	throw new Error(`Missing or invalid env vars: ${parsed.map((e) => e.path.join(".")).join(", ")}`);
}
export const env = parsed;
