// Owns: the class's Pengumuman page: every announcement newest first, and for teachers the write box plus edit and delete. Not here: the route (src/routes/_app/kelas/$classId/pengumuman.tsx), the shared post pieces (src/components/post-parts.tsx), or announcement rules (src/server/announcements.ts).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Byline, ItemMenu, WriteBox } from "#/components/post-parts";
import { Markdown } from "#/components/step-kinds-ui";
import type { ClassId } from "#/db/ids";
import { type RefusalOf, refusalMessage } from "#/lib/refused";
import {
	type Announcement,
	announcementsQuery,
	createAnnouncementFn,
	deleteAnnouncementFn,
	editAnnouncementFn,
} from "#/server/announcement-fns";
import { orThrow } from "#/server/module-fns";

// Create and delete refuse for the same two reasons as edit, so lint calls listing all three a duplicate.
const REFUSED: Record<RefusalOf<typeof editAnnouncementFn>, string> = {
	not_found: "Pengumuman ini sudah tidak ada.",
	forbidden: "Hanya penulisnya yang bisa mengubah pengumuman ini.",
};

function useRefresh() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: ["announcements"] });
}

export function Announcements({
	userId,
	classId,
	teacher,
}: {
	userId: string;
	classId: ClassId;
	teacher: boolean;
}) {
	const { data: announcements } = useSuspenseQuery(announcementsQuery(userId, classId));
	const refresh = useRefresh();
	return (
		<div className="mx-auto max-w-[68ch] px-4 py-8 md:px-8">
			<h1 className="text-2xl font-semibold tracking-tight">Pengumuman</h1>
			{teacher ? (
				<div className="mt-6">
					<WriteBox
						label="Pengumuman baru"
						placeholder="Tulis pengumuman untuk kelas…"
						submitLabel="Umumkan"
						save={async (body) => {
							orThrow(await createAnnouncementFn({ data: { classId, announcement: { body } } }));
							await refresh();
						}}
						refused={REFUSED}
					/>
				</div>
			) : null}
			{announcements.length === 0 ? (
				<p className="mt-6 border-t pt-6 text-sm text-muted-foreground">Belum ada pengumuman.</p>
			) : (
				<ul className="mt-6">
					{announcements.map((a) => (
						<li key={a.id} className="border-t py-5">
							<Item announcement={a} teacher={teacher} />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

// Only the author edits, because their name is on it. Any teacher of the class deletes.
function Item({ announcement: a, teacher }: { announcement: Announcement; teacher: boolean }) {
	const refresh = useRefresh();
	const [editing, setEditing] = useState(false);
	const remove = useMutation({
		mutationFn: async () => orThrow(await deleteAnnouncementFn({ data: { announcementId: a.id } })),
		onSuccess: refresh,
	});
	return (
		<div className="grid gap-1">
			<div className="flex items-start gap-2">
				<Byline
					name={a.authorName}
					mine={a.mine}
					createdAt={a.createdAt}
					editedAt={a.editedAt}
					className="flex-1"
				/>
				{editing ? null : (
					<ItemMenu
						what="pengumuman"
						label={a.authorName}
						consequence="Siswa tidak akan melihatnya lagi."
						onEdit={a.mine ? () => setEditing(true) : undefined}
						onDelete={teacher ? () => remove.mutate() : undefined}
					/>
				)}
			</div>
			{editing ? (
				<WriteBox
					label="Ubah pengumuman"
					submitLabel="Simpan"
					initial={a.body}
					focusOnOpen
					save={async (body) => {
						orThrow(
							await editAnnouncementFn({ data: { announcementId: a.id, announcement: { body } } }),
						);
						await refresh();
					}}
					refused={REFUSED}
					onDone={() => setEditing(false)}
					onCancel={() => setEditing(false)}
				/>
			) : (
				<Markdown className="text-sm leading-6">{a.body}</Markdown>
			)}
			<p role="alert" className="text-sm text-destructive empty:hidden">
				{refusalMessage(remove.error, REFUSED, "Tidak bisa menghapus. Coba lagi.")}
			</p>
		</div>
	);
}
