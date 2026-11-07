// Owns: the class page at /kelas/$classId (header and body), remembering it as the last class, and its not-found screen. Not here: the rail and guard (src/routes/_app.tsx) or class rules (src/server/classes.ts).

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { useEffect } from "react";
import { InviteBanner } from "#/components/invite-banner";
import { ClassId } from "#/db/ids";
import { ROLE_LABEL } from "#/lib/class-labels";
import { getClassFn, listMembersFn, setLastClassFn } from "#/server/class-fns";

export const Route = createFileRoute("/_app/kelas/$classId")({
	// A malformed id and a class you aren't in end the same way, so non-members learn nothing.
	loader: async ({ params }) => {
		const classId = ClassId(params.classId);
		if (classId instanceof type.errors) throw notFound();
		const [found, members] = await Promise.all([
			getClassFn({ data: { classId } }),
			listMembersFn({ data: { classId } }),
		]);
		if (!found.ok || !members.ok) throw notFound();
		return { cls: found.class, memberCount: members.members.length };
	},
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData ? `${loaderData.cls.title} · Ruang Belajar` : "Ruang Belajar" }],
	}),
	component: ClassPage,
	notFoundComponent: ClassNotFound,
});

function ClassPage() {
	const { cls, memberCount } = Route.useLoaderData();

	// Set here, not in the loader: hovering a rail tile preloads the loader and must not count as opening.
	// The cookie is only a hint, so a failed write is ignored.
	useEffect(() => {
		setLastClassFn({ data: { classId: cls.id } }).catch(() => undefined);
	}, [cls.id]);

	return (
		<>
			<header className="flex h-14 items-center gap-3 border-b px-4 sm:px-6">
				<h1 title={cls.title} className="min-w-0 truncate font-medium">
					{cls.title}
				</h1>
				<span className="shrink-0 text-sm text-muted-foreground">
					{ROLE_LABEL[cls.myRole]} · {memberCount} anggota
				</span>
			</header>
			<InviteBanner />
			<p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">Belum ada modul.</p>
		</>
	);
}

function ClassNotFound() {
	return (
		<>
			<InviteBanner />
			<div className="grid justify-items-start gap-3 px-4 py-6 sm:px-6">
				<h1 className="font-medium">Kelas tidak ditemukan.</h1>
				<Link
					to="/"
					className="text-sm font-medium text-primary underline-offset-4 hover:underline"
				>
					Ke kelasmu
				</Link>
			</div>
		</>
	);
}
