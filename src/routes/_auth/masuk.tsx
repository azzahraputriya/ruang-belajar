// Owns: the sign-in page at /masuk. Not here: the split-screen layout (src/routes/_auth.tsx) or sign-in itself (better-auth, via src/lib/auth-client.ts).

import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type } from "arktype";
import { useState } from "react";
import { flushSync } from "react-dom";
import { FormField } from "#/components/form-field";
import { FormSubmit } from "#/components/form-submit";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/_auth/masuk")({
	head: () => ({ meta: [{ title: "Masuk · Ruang Belajar" }] }),
	component: SignIn,
});

const SignInForm = type({ username: "string", password: "string" });
type Field = keyof typeof SignInForm.infer;

const EMPTY: Record<Field, string> = {
	username: "Isi nama pengguna.",
	password: "Isi kata sandi.",
};

// better-auth's own messages are English, so only the status picks the Indonesian line.
// Every 4xx except 429 reads as wrong credentials, including a malformed username.
function signInFailure(status: number) {
	if (status === 429) return "Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.";
	if (status >= 400 && status < 500) return "Nama pengguna atau kata sandi salah.";
	return "Tidak bisa masuk sekarang. Coba lagi.";
}

function SignIn() {
	const navigate = useNavigate();
	const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
	const [formError, setFormError] = useState("");

	const signIn = useMutation({
		mutationFn: async (input: Record<Field, string>) => {
			const { error } = await authClient.signIn.username(input);
			return error ? signInFailure(error.status) : null;
		},
		onSuccess: async (failure) => {
			if (failure) {
				setFormError(failure);
				return;
			}
			await navigate({ to: "/" });
		},
		onError: () => setFormError("Tidak bisa masuk sekarang. Periksa koneksi, lalu coba lagi."),
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const input = SignInForm.assert(Object.fromEntries(new FormData(event.currentTarget)));
		const errors: Partial<Record<Field, string>> = {};
		if (!input.username.trim()) errors.username = EMPTY.username;
		if (!input.password) errors.password = EMPTY.password;
		// Render the errors before moving focus, so a screen reader reads the field with its error.
		flushSync(() => {
			setFieldErrors(errors);
			setFormError("");
		});
		const first = Object.keys(errors)[0];
		if (first) {
			document.getElementById(first)?.focus();
			return;
		}
		signIn.mutate({ ...input, username: input.username.trim() });
	}

	return (
		<>
			<h1 className="text-xl font-semibold tracking-tight">Masuk</h1>
			{/* POST, so a tap before the page script loads never puts the password in the URL. */}
			<form method="post" className="grid gap-4" noValidate onSubmit={onSubmit}>
				<FormField
					id="username"
					label="Nama pengguna"
					autoComplete="username"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					error={fieldErrors.username}
				/>
				<FormField
					id="password"
					label="Kata sandi"
					type="password"
					autoComplete="current-password"
					error={fieldErrors.password}
				/>
				<FormSubmit label="Masuk" pending={signIn.isPending} error={formError} />
			</form>
			<p className="text-sm text-muted-foreground">
				Belum punya akun?{" "}
				<Link to="/daftar" className="font-medium text-primary underline-offset-4 hover:underline">
					Daftar
				</Link>
			</p>
		</>
	);
}
