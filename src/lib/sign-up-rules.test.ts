// Owns: tests for the sign-up screen's field errors. Not here: server-side sign-up tests (src/server/auth.test.ts).

import { describe, expect, it } from "vitest";
import { signUpErrors } from "#/lib/sign-up-rules";

const valid = { username: "budi", name: "Budi Santoso", password: "rahasia-123" };

describe("signUpErrors", () => {
	it("returns nothing for valid input, in any letter case", () => {
		expect(signUpErrors(valid)).toEqual({});
		expect(signUpErrors({ ...valid, username: "Budi.S" })).toEqual({});
	});

	it("names every broken field, in Indonesian", () => {
		const errors = signUpErrors({ username: "a b", name: "   ", password: "pendek" });
		expect(errors).toEqual({
			username:
				"Gunakan 3–30 huruf, angka, titik, atau garis bawah. Titik tidak boleh di awal atau akhir.",
			name: "Isi nama tampilan, paling banyak 80 karakter.",
			password: "Gunakan 8 sampai 128 karakter.",
		});
	});

	it("flags only the field that broke", () => {
		expect(Object.keys(signUpErrors({ ...valid, username: ".budi" }))).toEqual(["username"]);
	});
});
