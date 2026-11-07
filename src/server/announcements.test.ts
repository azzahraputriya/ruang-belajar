// Owns: tests for class announcements (who writes, who reads, and their order) against the test database. Not here: discussion posts (src/server/discussions.test.ts) or test setup (src/test/).

import { describe, expect, it } from "vitest";
import type { ClassId, UserId } from "#/db/ids";
import {
	AnnouncementInput,
	createAnnouncement,
	deleteAnnouncement,
	editAnnouncement,
	listAnnouncements,
} from "#/server/announcements";
import { acceptInvite } from "#/server/classes";
import { classWithStudent, inviteOk, makeUser } from "#/test/fixtures";

const body = (text: string) => AnnouncementInput.assert({ body: text });
const notFound = { ok: false, reason: "not_found" };
const forbidden = { ok: false, reason: "forbidden" };

async function announceOk(teacher: UserId, classId: ClassId, text: string) {
	const result = await createAnnouncement(teacher, classId, body(text));
	if (!result.ok) throw new Error(`createAnnouncement failed: ${result.reason}`);
	return result.announcementId;
}

async function bodiesFor(actor: UserId, classId: ClassId) {
	const result = await listAnnouncements(actor, classId);
	if (!result.ok) throw new Error(`listAnnouncements failed: ${result.reason}`);
	return result.announcements.map((a) => a.body);
}

describe("announcements", () => {
	it("show every member the class's announcements, newest first, with the author's name", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		await announceOk(guru, classId, "Pertama.");
		await announceOk(guru, classId, "Kedua.");
		await announceOk(guru, classId, "Ketiga.");
		expect(await bodiesFor(siswa, classId)).toEqual(["Ketiga.", "Kedua.", "Pertama."]);
		const result = await listAnnouncements(siswa, classId);
		if (!result.ok) throw new Error(result.reason);
		expect(new Set(Object.keys(result.announcements[0] ?? {}))).toEqual(
			new Set(["authorName", "body", "createdAt", "editedAt", "id"]),
		);
		expect(result.announcements[0]?.authorName).toBe("guru");
	});

	it("keep another class's announcements out, and give outsiders nothing", async () => {
		const a = await classWithStudent("a");
		const b = await classWithStudent("b");
		await announceOk(a.guru, a.classId, "Untuk kelas A.");
		await announceOk(b.guru, b.classId, "Untuk kelas B.");
		expect(await bodiesFor(a.siswa, a.classId)).toEqual(["Untuk kelas A."]);
		expect(await listAnnouncements(a.siswa, b.classId)).toEqual(notFound);
		expect(await listAnnouncements(a.orang, a.classId)).toEqual(notFound);
	});

	it("are written only by teachers", async () => {
		const { guru, siswa, orang, classId } = await classWithStudent();
		expect(await createAnnouncement(siswa, classId, body("Dari siswa."))).toEqual(forbidden);
		expect(await createAnnouncement(orang, classId, body("Dari luar."))).toEqual(notFound);
		const id = await announceOk(guru, classId, "Dari guru.");
		expect(await editAnnouncement(siswa, id, body("Diubah."))).toEqual(forbidden);
		expect(await editAnnouncement(orang, id, body("Diubah."))).toEqual(notFound);
		expect(await deleteAnnouncement(siswa, id)).toEqual(forbidden);
		expect(await deleteAnnouncement(orang, id)).toEqual(notFound);
		expect(await bodiesFor(siswa, classId)).toEqual(["Dari guru."]);
	});

	it("are edited only by their author, and deleted by any teacher of the class", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const rekan = await makeUser("rekan");
		await acceptInvite(rekan, await inviteOk(guru, classId, "rekan", "teacher"));
		const id = await announceOk(guru, classId, "Ujian hari Senin.");

		expect(await editAnnouncement(rekan, id, body("Ujian dibatalkan."))).toEqual(forbidden);
		expect(await editAnnouncement(guru, id, body("Ujian hari Selasa."))).toEqual({ ok: true });
		const result = await listAnnouncements(siswa, classId);
		if (!result.ok) throw new Error(result.reason);
		expect(result.announcements.map((a) => a.body)).toEqual(["Ujian hari Selasa."]);
		expect(result.announcements[0]?.editedAt).toBeInstanceOf(Date);

		expect(await deleteAnnouncement(rekan, id)).toEqual({ ok: true });
		expect(await bodiesFor(siswa, classId)).toEqual([]);
		expect(await editAnnouncement(guru, id, body("Lagi."))).toEqual(notFound);
	});
});
