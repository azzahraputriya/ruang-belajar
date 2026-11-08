// Owns: the class's announcements pane at /kelas/$classId/pengumuman, for every member, and its not-found message. Not here: the page itself (src/components/announcements.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { Announcements } from "#/components/announcements";
import { PaneMessage } from "#/components/pane-message";
import { ClassId } from "#/db/ids";
import { announcementsQuery } from "#/server/announcement-fns";

export const Route = createFileRoute("/_app/kelas/$classId/pengumuman")({
	loader: async ({ params, parentMatchPromise, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		const { loaderData } = await parentMatchPromise;
		if (classId instanceof type.errors || !loaderData) throw notFound();
		await queryClient.ensureQueryData(announcementsQuery(user.id, classId));
		return { classId, teacher: loaderData.cls.myRole === "teacher" };
	},
	head: () => ({ meta: [{ title: "Pengumuman · Ruang Belajar" }] }),
	component: AnnouncementsPane,
	notFoundComponent: () => <PaneMessage title="Halaman tidak ditemukan." />,
});

function AnnouncementsPane() {
	const { classId, teacher } = Route.useLoaderData();
	const { user } = Route.useRouteContext();
	return <Announcements userId={user.id} classId={classId} teacher={teacher} />;
}
