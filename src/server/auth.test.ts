// Owns: tests for sign-up, sign-in, session, and sign-out against the test database. Not here: test setup (src/test/).

import { APIError } from "better-auth";
import { describe, expect, it } from "vitest";
import { auth, emailForUsername, signUp } from "#/server/auth";
import { cookiesFrom } from "#/test/fixtures";

const budi = { username: "budi", name: "Budi Santoso", password: "rahasia-123" };

describe("accounts", () => {
	it("signs up, reads the session, and signs out", async () => {
		const { headers, response } = await signUp(budi);
		expect(response.user).toMatchObject({
			name: "Budi Santoso",
			username: "budi",
			email: "budi@users.ruang-belajar.invalid",
		});

		const browser = cookiesFrom(headers);
		const session = await auth.api.getSession({ headers: browser });
		expect(session?.user.username).toBe("budi");

		await auth.api.signOut({ headers: browser });
		expect(await auth.api.getSession({ headers: browser })).toBeNull();
	});

	it("signs in by username in any letter case", async () => {
		await signUp(budi);
		const { headers } = await auth.api.signInUsername({
			body: { username: "BUDI", password: budi.password },
			returnHeaders: true,
		});
		const session = await auth.api.getSession({ headers: cookiesFrom(headers) });
		expect(session?.user.name).toBe("Budi Santoso");
	});

	it("rejects a wrong password", async () => {
		await signUp(budi);
		await expect(
			auth.api.signInUsername({ body: { username: "budi", password: "salah-salah" } }),
		).rejects.toMatchObject({ statusCode: 401 });
	});

	it("rejects a username that is taken, in any letter case", async () => {
		await signUp(budi);
		const taken = { body: { code: "USERNAME_IS_ALREADY_TAKEN" } };
		await expect(signUp({ ...budi, username: "Budi", name: "Budi Lain" })).rejects.toMatchObject(
			taken,
		);
		// Straight to better-auth, skipping signUp()'s lowercasing, to prove the plugin compares case-insensitively.
		await expect(
			auth.api.signUpEmail({
				body: { ...budi, username: "BUDI", email: emailForUsername("budi") },
			}),
		).rejects.toMatchObject(taken);
	});

	it("rejects a raw sign-up with a real email or a bad username", async () => {
		const error = await auth.api
			.signUpEmail({ body: { ...budi, email: "budi@example.com" } })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(APIError);
		expect(error).toMatchObject({ statusCode: 400 });
		expect(error instanceof APIError && error.message).not.toContain(budi.password);
		await expect(signUp({ ...budi, username: "bu di" })).rejects.toThrow();
	});

	it("refuses raw sign-up fields signUp() never sends", async () => {
		const email = emailForUsername("budi");
		await expect(
			auth.api.signUpEmail({ body: { ...budi, email, image: "https://evil.example/x.png" } }),
		).rejects.toMatchObject({ statusCode: 400 });
		await expect(
			auth.api.signUpEmail({ body: { ...budi, email, name: "  Budi  " } }),
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it("keeps the username fixed, but lets the display name change", async () => {
		const { headers } = await signUp(budi);
		const browser = cookiesFrom(headers);
		await expect(
			auth.api.updateUser({ headers: browser, body: { username: "andi" } }),
		).rejects.toMatchObject({ statusCode: 400 });
		await auth.api.updateUser({ headers: browser, body: { name: "Budi S." } });
		const session = await auth.api.getSession({ headers: browser });
		expect(session?.user).toMatchObject({ username: "budi", name: "Budi S." });
	});
});
