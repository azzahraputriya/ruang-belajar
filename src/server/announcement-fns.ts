// Owns: the server functions and query the announcement screens call, which find the signed-in user and parse input. Not here: the announcement rules themselves (src/server/announcements.ts).

import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { AnnouncementId, ClassId } from "#/db/ids";
import {
	AnnouncementInput,
	createAnnouncement,
	deleteAnnouncement,
	editAnnouncement,
	listAnnouncements,
} from "#/server/announcements";
import { requireActor } from "#/server/class-fns";
import { retry } from "#/server/module-fns";

const InClass = type({ classId: ClassId });
const ForAnnouncement = type({ announcementId: AnnouncementId });

export const listAnnouncementsFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => listAnnouncements(await requireActor(), data.classId));

// Fields sit under `announcement`, because AnnouncementInput trims (a morph) and ArkType's merge only takes plain objects.
export const createAnnouncementFn = createServerFn({ method: "POST" })
	.validator(InClass.merge({ announcement: AnnouncementInput }))
	.handler(async ({ data }) =>
		createAnnouncement(await requireActor(), data.classId, data.announcement),
	);

export const editAnnouncementFn = createServerFn({ method: "POST" })
	.validator(ForAnnouncement.merge({ announcement: AnnouncementInput }))
	.handler(async ({ data }) =>
		editAnnouncement(await requireActor(), data.announcementId, data.announcement),
	);

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
	.validator(ForAnnouncement)
	.handler(async ({ data }) => deleteAnnouncement(await requireActor(), data.announcementId));

export const announcementsQuery = (userId: string, classId: ClassId) =>
	queryOptions({
		queryKey: ["announcements", userId, classId],
		retry,
		queryFn: async () => {
			const result = await listAnnouncementsFn({ data: { classId } });
			if (!result.ok) throw notFound();
			return result.announcements;
		},
	});
export type Announcement = Extract<
	Awaited<ReturnType<typeof listAnnouncements>>,
	{ ok: true }
>["announcements"][number];
