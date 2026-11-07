// Owns: the class layout at /kelas/$classId (header, invite banner, syllabus beside the open pane), loading the class with its modules and the student's progress, remembering it as the last class, and its not-found screen. Not here: the panes (src/routes/_app/kelas/$classId/), the syllabus itself (src/components/syllabus.tsx), or class rules (src/server/classes.ts).

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { type } from "arktype";
import { useEffect } from "react";
import { InviteBanner } from "#/components/invite-banner";
import { MembersPanel } from "#/components/members-panel";
import { SyllabusAside, SyllabusBar, type SyllabusProps } from "#/components/syllabus";
import { ClassId } from "#/db/ids";
import { ROLE_LABEL } from "#/lib/class-labels";
import { getClassFn, membersQuery, setLastClassFn } from "#/server/class-fns";
import { modulesQuery, progressQuery } from "#/server/module-fns";
import { waitingCountQuery } from "#/server/submission-fns";

export const Route = createFileRoute("/_app/kelas/$classId")({
	// Every step click is a child navigation, which would rerun this loader. The class title and your
	// role rarely change, so a minute old is fine. The member count, modules, and progress have their
	// own queries, and the members panel reloads this route itself when your role changes.
	staleTime: 60_000,
	// A malformed id and a class you aren't in end the same way, so non-members learn nothing.
	// The member list goes through the same query as the members panel, so the header's count
	// refreshes whenever that query does: when the panel opens, after a change, and when you come
	// back to the tab after someone else joined or left.
	loader: async ({ params, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		if (classId instanceof type.errors) throw notFound();
		const [found, members] = await Promise.all([
			getClassFn({ data: { classId } }),
			// fetchQuery, not ensureQueryData: a cached "not found" from before you (re)joined would block the page.
			queryClient.fetchQuery(membersQuery(user.id, classId)),
		]);
		if (!found.ok || !members.ok) throw notFound();
		// Membership is settled above, so these only fail if the class changes in between.
		await Promise.all([
			queryClient.ensureQueryData(modulesQuery(user.id, classId)),
			found.class.myRole === "student"
				? queryClient.ensureQueryData(progressQuery(user.id, classId))
				: undefined,
		]);
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
	const student = cls.myRole === "student";
	const { data: members } = useSuspenseQuery(membersQuery(user.id, cls.id));
	const { data: modules } = useSuspenseQuery(modulesQuery(user.id, cls.id));
	const { data: statusById } = useQuery({ ...progressQuery(user.id, cls.id), enabled: student });
	// Not awaited in the loader: the count can arrive after the page shows.
	const { data: waiting } = useQuery({ ...waitingCountQuery(user.id, cls.id), enabled: !student });

	// Set here, not in the loader: hovering a rail tile preloads the loader and must not count as opening.
	// The cookie is only a hint, so a failed write is ignored.
	useEffect(() => {
		setLastClassFn({ data: { classId: cls.id } }).catch(() => undefined);
	}, [cls.id]);

	const syllabus: SyllabusProps = {
		classId: cls.id,
		teacher: !student,
		modules,
		statusById,
		waiting,
	};

	return (
		<div className="flex min-h-svh flex-col">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
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
			<div className="flex flex-1">
				<SyllabusAside {...syllabus} />
				<div className="min-w-0 flex-1">
					<SyllabusBar {...syllabus} />
					<Outlet />
				</div>
			</div>
		</div>
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
