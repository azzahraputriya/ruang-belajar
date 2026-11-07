// Owns: the sign-up page at /daftar. Not here: the split-screen layout (src/routes/_auth.tsx), the sign-up rules and their messages (src/lib/sign-up-rules.ts), or the server side (src/server/sign-up-fn.ts).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type } from "arktype";
import { useState } from "react";
import { flushSync } from "react-dom";
import { FormField } from "#/components/form-field";
import { FormSubmit } from "#/components/form-submit";
import { type SignUpField, type SignUpInput, signUpErrors } from "#/lib/sign-up-rules";
import { resetSession } from "#/server/session-fn";
import { signUpFn } from "#/server/sign-up-fn";

export const Route = createFileRoute("/_auth/daftar")({
	head: () => ({ meta: [{ title: "Daftar · Ruang Belajar" }] }),
	component: SignUp,
});

const SignUpForm = type({ username: "string", name: "string", password: "string" });
type FieldErrors = Partial<Record<SignUpField, string>>;

function SignUp() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [formError, setFormError] = useState("");

	// Render the errors before moving focus, so a screen reader reads the field with its error.
	function showErrors(errors: FieldErrors, form = "") {
		flushSync(() => {
			setFieldErrors(errors);
			setFormError(form);
		});
		const first = (["username", "name", "password"] as const).find((field) => errors[field]);
		if (first) document.getElementById(first)?.focus();
	}

	const signUp = useMutation({
		mutationFn: (input: SignUpInput) => signUpFn({ data: input }),
		onSuccess: async (result) => {
			if (!result.ok) {
				showErrors({ username: "Nama pengguna ini sudah dipakai. Pilih yang lain." });
				return;
			}
			resetSession(queryClient);
			await navigate({ to: "/" });
		},
		onError: () => showErrors({}, "Tidak bisa mendaftar sekarang. Coba lagi."),
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = SignUpForm.assert(Object.fromEntries(new FormData(event.currentTarget)));
		const input = { ...form, username: form.username.trim() };
		const errors = signUpErrors(input);
		showErrors(errors);
		if (Object.keys(errors).length === 0) signUp.mutate(input);
	}

	return (
		<>
			<h1 className="text-xl font-semibold tracking-tight">Buat akun</h1>
			<form className="grid gap-4" noValidate onSubmit={onSubmit}>
				<FormField
					id="username"
					label="Nama pengguna"
					hint="Huruf kecil, angka, titik, atau garis bawah."
					autoComplete="username"
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					error={fieldErrors.username}
				/>
				<FormField
					id="name"
					label="Nama tampilan"
					hint="Dilihat guru dan teman sekelas."
					autoComplete="name"
					error={fieldErrors.name}
				/>
				<FormField
					id="password"
					label="Kata sandi"
					hint="Minimal 8 karakter."
					type="password"
					autoComplete="new-password"
					error={fieldErrors.password}
				/>
				<FormSubmit label="Daftar" pending={signUp.isPending} error={formError} />
			</form>
			<p className="text-sm text-muted-foreground">
				Sudah punya akun?{" "}
				<Link to="/masuk" className="font-medium text-primary underline-offset-4 hover:underline">
					Masuk
				</Link>
			</p>
		</>
	);
}
