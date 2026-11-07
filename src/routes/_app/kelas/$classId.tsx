// Owns: the class page at /kelas/$classId (header and body), remembering it as the last class, and its not-found screen. Not here: the rail and guard (src/routes/_app.tsx) or class rules (src/server/classes.ts).

import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { useEffect } from "react";
import { InviteBanner } from "#/components/invite-banner";
import { MembersPanel } from "#/components/members-panel";
import { ClassId } from "#/db/ids";
import { ROLE_LABEL } from "#/lib/class-labels";
import { getClassFn, membersQuery, setLastClassFn } from "#/server/class-fns";

export const Route = createFileRoute("/_app/kelas/$classId")({
	// A malformed id and a class you aren't in end the same way, so non-members learn nothing.
	// The member list goes through the same query as the members panel, so the header's count
	// refreshes whenever that query does: when the panel opens, after a change, and when you come
	// back to the tab after someone else joined or left.
	loader: async ({ params, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		if (classId instanceof type.errors) throw notFound();
		const [found, members] = await Promise.all([
			getClassFn({ data: { classId } }),
			queryClient.ensureQueryData(membersQuery(user.id, classId)),
		]);
		if (!found.ok || !members.ok) throw notFound();
		return { cls: found.class };
	},
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData ? `${loaderData.cls.title} · Ruang Belajar` : "Ruang Belajar" }],
	}),
	component: ClassPage,
	notFoundComponent: ClassNotFound,
});

function ClassPage() {
	const { cls } = Route.useLoaderData();
	const { user } = Route.useRouteContext();
	const { data: members } = useSuspenseQuery(membersQuery(user.id, cls.id));

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
					{ROLE_LABEL[cls.myRole]}
					{members.ok ? ` · ${members.members.length} anggota` : null}
				</span>
				<MembersPanel cls={cls} />
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
