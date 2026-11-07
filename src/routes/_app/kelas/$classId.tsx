// Owns: the class layout at /kelas/$classId (header, invite banner, syllabus beside the open pane), loading the class with its modules and the student's progress, remembering it as the last class, and its not-found screen. Not here: the panes (src/routes/_app/kelas/$classId/), the syllabus itself (src/components/syllabus.tsx), or class rules (src/server/classes.ts).

import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { type } from "arktype";
import { useEffect } from "react";
import { InviteBanner } from "#/components/invite-banner";
import { SyllabusAside, SyllabusBar, type SyllabusProps } from "#/components/syllabus";
import { ClassId } from "#/db/ids";
import { ROLE_LABEL } from "#/lib/class-labels";
import { getClassFn, listMembersFn, setLastClassFn } from "#/server/class-fns";
import { modulesQuery, progressQuery } from "#/server/module-fns";

export const Route = createFileRoute("/_app/kelas/$classId")({
	// Every step click is a child navigation, which would rerun this loader. The class title and
	// member count rarely change, so a minute old is fine. Modules and progress have their own queries.
	staleTime: 60_000,
	// A malformed id and a class you aren't in end the same way, so non-members learn nothing.
	loader: async ({ params, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		if (classId instanceof type.errors) throw notFound();
		const [found, members] = await Promise.all([
			getClassFn({ data: { classId } }),
			listMembersFn({ data: { classId } }),
		]);
		if (!found.ok || !members.ok) throw notFound();
		// Membership is settled above, so these only fail if the class changes in between.
		await Promise.all([
			queryClient.ensureQueryData(modulesQuery(user.id, classId)),
			found.class.myRole === "student"
				? queryClient.ensureQueryData(progressQuery(user.id, classId))
				: undefined,
		]);
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
	const { user } = Route.useRouteContext();
	const student = cls.myRole === "student";
	const { data: modules } = useSuspenseQuery(modulesQuery(user.id, cls.id));
	const { data: statusById } = useQuery({ ...progressQuery(user.id, cls.id), enabled: student });

	// Set here, not in the loader: hovering a rail tile preloads the loader and must not count as opening.
	// The cookie is only a hint, so a failed write is ignored.
	useEffect(() => {
		setLastClassFn({ data: { classId: cls.id } }).catch(() => undefined);
	}, [cls.id]);

	const syllabus: SyllabusProps = { classId: cls.id, teacher: !student, modules, statusById };

	return (
		<div className="flex min-h-svh flex-col">
			<header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
				<h1 title={cls.title} className="min-w-0 truncate font-medium">
					{cls.title}
				</h1>
				<span className="shrink-0 text-sm text-muted-foreground">
					{ROLE_LABEL[cls.myRole]} · {memberCount} anggota
				</span>
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
