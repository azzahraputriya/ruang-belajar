// Owns: the sign-up rules for username, display name, and password, and the Indonesian message shown when each is broken. Shared by the sign-up screen and the server. Not here: better-auth setup (src/server/auth.ts).

import { type } from "arktype";

// Accepts any case and stores lowercase, so "Budi" and "budi" are the same account.
// No dot at either end and no two dots in a row: the username becomes the placeholder email's local part.
export const Username = type("string.lower")
	.to(/^(?!.*\.\.)[a-z0-9_][a-z0-9_.]{1,28}[a-z0-9_]$/)
	.describe("3 to 30 letters, digits, _ or ., not starting or ending with a dot");

const Name = type("string.trim").to("1 <= string <= 80");
export const PASSWORD = { min: 8, max: 128 };

export const Password = type("string").atLeastLength(PASSWORD.min).atMostLength(PASSWORD.max);

export const SignUpInput = type({ username: Username, name: Name, password: Password });
export type SignUpInput = typeof SignUpInput.inferIn;
export type SignUpField = keyof SignUpInput;

// One message per field rather than per failure: each field has one rule, so the message can just restate it.
const MESSAGES: Record<SignUpField, string> = {
	username:
		"Gunakan 3–30 huruf, angka, titik, atau garis bawah. Titik tidak boleh di awal atau akhir.",
	name: "Isi nama tampilan, paling banyak 80 karakter.",
	password: `Gunakan ${PASSWORD.min} sampai ${PASSWORD.max} karakter.`,
};

// The fields that break a rule, each with its message. Empty means the input is valid.
export function signUpErrors(input: SignUpInput): Partial<Record<SignUpField, string>> {
	const result = SignUpInput(input);
	if (!(result instanceof type.errors)) return {};
	const errors: Partial<Record<SignUpField, string>> = {};
	for (const error of result) {
		const field = error.path[0];
		if (field === "username" || field === "name" || field === "password") {
			errors[field] = MESSAGES[field];
		}
	}
	return errors;
}
