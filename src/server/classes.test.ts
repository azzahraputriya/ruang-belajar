// Owns: tests for classes, members, invites, and the last-teacher rule against the test database. Not here: test setup (src/test/).

import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { describe, expect, it } from "vitest";
import { classInvite } from "#/db/class-schema";
import { db } from "#/db/client";
import { ClassId, InviteId, UserId } from "#/db/ids";
import { signUp } from "#/server/auth";
import {
	CreateClassInput,
	InviteInput,
	acceptInvite,
	changeRole,
	createClass,
	declineInvite,
	getClass,
	invite,
	leaveClass,
	listMembers,
	listMyClasses,
	listMyPendingInvites,
	removeMember,
	revokeInvite,
} from "#/server/classes";

async function makeUser(username: string) {
	const { response } = await signUp({ username, name: username, password: "rahasia-123" });
	return UserId.assert(response.user.id);
}

async function makeClass(teacher: UserId, title = "Fisika X-1") {
	const result = await createClass(teacher, CreateClassInput.assert({ title, subject: "Fisika" }));
	return result.class.id;
}

async function inviteOk(teacher: UserId, classId: ClassId, username: string, role?: "teacher") {
	const result = await invite(
		teacher,
		classId,
		InviteInput.assert({ username, ...(role && { role }) }),
	);
	if (!result.ok) throw new Error(`invite failed: ${result.reason}`);
	return result.inviteId;
}

// A teacher, a student who joined by invite, and an outsider.
async function classWithStudent() {
	const guru = await makeUser("guru");
	const siswa = await makeUser("siswa");
	const orang = await makeUser("orang");
	const classId = await makeClass(guru);
	await acceptInvite(siswa, await inviteOk(guru, classId, "siswa"));
	return { guru, siswa, orang, classId };
}

const missingClass = () => ClassId.assert(randomUUID());
const missingInvite = () => InviteId.assert(randomUUID());

describe("input rules", () => {
	it("trims the title and subject and limits their length", () => {
		expect(CreateClassInput.assert({ title: "  Fisika  ", subject: " IPA " })).toEqual({
			title: "Fisika",
			subject: "IPA",
		});
		expect(CreateClassInput({ title: "   ", subject: "IPA" })).toBeInstanceOf(type.errors);
		expect(CreateClassInput({ title: "a".repeat(101), subject: "IPA" })).toBeInstanceOf(
			type.errors,
		);
		expect(CreateClassInput({ title: "Fisika", subject: "a".repeat(61) })).toBeInstanceOf(
			type.errors,
		);
	});

	it("defaults the invite role to student and refuses other roles", () => {
		expect(InviteInput.assert({ username: "budi" }).role).toBe("student");
		expect(InviteInput({ username: "budi", role: "admin" })).toBeInstanceOf(type.errors);
	});
});

describe("classes", () => {
	it("makes the creator the first teacher", async () => {
		const guru = await makeUser("guru");
		const classId = await makeClass(guru);
		expect(await getClass(guru, classId)).toMatchObject({
			ok: true,
			class: { title: "Fisika X-1", subject: "Fisika", aiTutorEnabled: false, myRole: "teacher" },
		});
		expect(await listMyClasses(guru)).toEqual([
			expect.objectContaining({ id: classId, myRole: "teacher" }),
		]);
	});

	it("lists only my classes, with my role in each", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		await makeClass(guru, "Kimia");
		expect((await listMyClasses(siswa)).map((c) => [c.id, c.myRole])).toEqual([
			[classId, "student"],
		]);
		expect((await listMyClasses(guru)).map((c) => c.title)).toEqual(["Fisika X-1", "Kimia"]);
	});

	it("lists members with their username and role", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const result = await listMembers(siswa, classId);
		expect(result.ok && result.members.map((m) => [m.username, m.role])).toEqual([
			["guru", "teacher"],
			["siswa", "student"],
		]);
		expect(result.ok && result.members.map((m) => m.userId)).toEqual([guru, siswa]);
	});
});

describe("non-members learn nothing", () => {
	it("get the same result as for a class that doesn't exist", async () => {
		const { siswa, orang, classId } = await classWithStudent();
		const missing = missingClass();
		const pairs = [
			[getClass(orang, classId), getClass(orang, missing)],
			[listMembers(orang, classId), listMembers(orang, missing)],
			[
				invite(orang, classId, InviteInput.assert({ username: "orang" })),
				invite(orang, missing, InviteInput.assert({ username: "orang" })),
			],
			[changeRole(orang, classId, siswa, "teacher"), changeRole(orang, missing, siswa, "teacher")],
			[removeMember(orang, classId, siswa), removeMember(orang, missing, siswa)],
			[leaveClass(orang, classId), leaveClass(orang, missing)],
		];
		for (const [a, b] of await Promise.all(pairs.map((pair) => Promise.all(pair)))) {
			expect(a).toEqual({ ok: false, reason: "not_found" });
			expect(a).toEqual(b);
		}
		expect(await listMyClasses(orang)).toEqual([]);
	});

	it("can't touch an invite that isn't theirs", async () => {
		const guru = await makeUser("guru");
		await makeUser("siswa");
		const orang = await makeUser("orang");
		const inviteId = await inviteOk(guru, await makeClass(guru), "siswa");
		const moves = [acceptInvite, declineInvite, revokeInvite];
		const results = await Promise.all(
			moves.flatMap((move) => [move(orang, inviteId), move(orang, missingInvite())]),
		);
		expect(results).toEqual(results.map(() => ({ ok: false, reason: "not_found" })));
		expect(await listMyPendingInvites(orang)).toEqual([]);
	});
});

describe("invites", () => {
	it("pending to accepted: the invitee joins with the invited role", async () => {
		const guru = await makeUser("guru");
		const bu = await makeUser("bu_ani");
		const classId = await makeClass(guru);
		const inviteId = await inviteOk(guru, classId, "bu_ani", "teacher");
		expect(await listMyPendingInvites(bu)).toEqual([
			expect.objectContaining({
				id: inviteId,
				classId,
				classTitle: "Fisika X-1",
				role: "teacher",
				invitedBy: "guru",
			}),
		]);
		expect(await acceptInvite(bu, inviteId)).toEqual({ ok: true, classId, status: "accepted" });
		expect(await getClass(bu, classId)).toMatchObject({ ok: true, class: { myRole: "teacher" } });
		expect(await listMyPendingInvites(bu)).toEqual([]);
	});

	it("accepting twice ends the same as once", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		const inviteId = await inviteOk(guru, classId, "siswa");
		const first = await acceptInvite(siswa, inviteId);
		expect(await acceptInvite(siswa, inviteId)).toEqual(first);
		const members = await listMembers(guru, classId);
		expect(members.ok && members.members).toHaveLength(2);
	});

	it("accepting two parallel requests of a fresh invite adds one member", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		const inviteId = await inviteOk(guru, classId, "siswa");
		const both = await Promise.all([acceptInvite(siswa, inviteId), acceptInvite(siswa, inviteId)]);
		expect(both.every((r) => r.ok)).toBe(true);
		const members = await listMembers(guru, classId);
		expect(members.ok && members.members).toHaveLength(2);
	});

	it("replaying an old accept after removal does not let you back in", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		const inviteId = await inviteOk(guru, classId, "siswa");
		await acceptInvite(siswa, inviteId);
		expect(await removeMember(guru, classId, siswa)).toEqual({ ok: true });
		expect((await acceptInvite(siswa, inviteId)).ok).toBe(true);
		expect(await getClass(siswa, classId)).toEqual({ ok: false, reason: "not_found" });
	});

	// invite() racing an earlier accept can leave a member with a pending invite. Built directly here.
	it("accepting an extra invite as a member closes it and keeps the role", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const [extra] = await db
			.insert(classInvite)
			.values({ classId, inviteeId: siswa, invitedById: guru, role: "teacher" })
			.returning({ id: classInvite.id });
		if (!extra) throw new Error("insert returned no row");
		expect(await acceptInvite(siswa, extra.id)).toEqual({ ok: true, classId, status: "accepted" });
		expect(await getClass(siswa, classId)).toMatchObject({ class: { myRole: "student" } });
		expect(await listMyPendingInvites(siswa)).toEqual([]);
	});

	it("a new invite sent while the old one is being accepted doesn't fail either request", async () => {
		const guru = await makeUser("guru");
		const runs = await Promise.all(
			Array.from({ length: 8 }, async (_, i) => {
				const siswa = await makeUser(`siswa_${i}`);
				const classId = await makeClass(guru, `Kelas ${i}`);
				const inviteId = await inviteOk(guru, classId, `siswa_${i}`);
				const [accepted, again] = await Promise.all([
					acceptInvite(siswa, inviteId),
					invite(guru, classId, InviteInput.assert({ username: `siswa_${i}` })),
				]);
				const members = await listMembers(guru, classId);
				return { accepted, again, members: members.ok ? members.members.length : 0 };
			}),
		);
		for (const { accepted, again, members } of runs) {
			expect(accepted.ok).toBe(true);
			// Either order is fine: before the accept commits the old invite is still pending, after it the student is a member.
			expect(again.ok || ["already_invited", "already_member"].includes(again.reason)).toBe(true);
			expect(members).toBe(2);
		}
	});

	it("pending to declined: the invitee does not join, and declining again is a no-op", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		const inviteId = await inviteOk(guru, classId, "siswa");
		const declined = { ok: true, classId, status: "declined" };
		expect(await declineInvite(siswa, inviteId)).toEqual(declined);
		expect(await declineInvite(siswa, inviteId)).toEqual(declined);
		expect(await getClass(siswa, classId)).toEqual({ ok: false, reason: "not_found" });
		expect(await listMyPendingInvites(siswa)).toEqual([]);
	});

	it("pending to revoked: a teacher revokes, and the invite disappears", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		const inviteId = await inviteOk(guru, classId, "siswa");
		const revoked = { ok: true, classId, status: "revoked" };
		expect(await revokeInvite(guru, inviteId)).toEqual(revoked);
		expect(await revokeInvite(guru, inviteId)).toEqual(revoked);
		expect(await listMyPendingInvites(siswa)).toEqual([]);
	});

	it("refuses to accept or decline a closed invite", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		const closed = { ok: false, reason: "invite_closed" };

		const declined = await inviteOk(guru, classId, "siswa");
		await declineInvite(siswa, declined);
		expect(await acceptInvite(siswa, declined)).toEqual(closed);
		expect(await revokeInvite(guru, declined)).toEqual(closed);

		const revoked = await inviteOk(guru, classId, "siswa");
		await revokeInvite(guru, revoked);
		expect(await acceptInvite(siswa, revoked)).toEqual(closed);
		expect(await declineInvite(siswa, revoked)).toEqual(closed);

		const accepted = await inviteOk(guru, classId, "siswa");
		await acceptInvite(siswa, accepted);
		expect(await declineInvite(siswa, accepted)).toEqual(closed);
		expect(await revokeInvite(guru, accepted)).toEqual(closed);
		expect(await getClass(siswa, classId)).toMatchObject({ ok: true });
	});

	it("lets only the invitee answer, and only a teacher revoke", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const baru = await makeUser("baru");
		const inviteId = await inviteOk(guru, classId, "baru");
		const forbidden = { ok: false, reason: "forbidden" };
		expect(await acceptInvite(guru, inviteId)).toEqual(forbidden);
		expect(await declineInvite(siswa, inviteId)).toEqual(forbidden);
		expect(await revokeInvite(siswa, inviteId)).toEqual(forbidden);
		expect(await revokeInvite(baru, inviteId)).toEqual(forbidden);
		expect(await listMyPendingInvites(baru)).toHaveLength(1);
	});

	it("finds the invitee by username in any letter case", async () => {
		const guru = await makeUser("guru");
		const budi = await makeUser("budi");
		const classId = await makeClass(guru);
		await inviteOk(guru, classId, "BuDi");
		expect(await listMyPendingInvites(budi)).toHaveLength(1);
	});

	it("refuses an unknown user, an existing member, and a second pending invite", async () => {
		const { guru, classId } = await classWithStudent();
		await makeUser("baru");
		const send = (username: string) => invite(guru, classId, InviteInput.assert({ username }));
		expect(await send("tidakada")).toEqual({ ok: false, reason: "user_not_found" });
		expect(await send("siswa")).toEqual({ ok: false, reason: "already_member" });
		expect(await send("guru")).toEqual({ ok: false, reason: "already_member" });
		expect((await send("baru")).ok).toBe(true);
		expect(await send("baru")).toEqual({ ok: false, reason: "already_invited" });
	});

	it("allows a new invite once the old one is closed", async () => {
		const guru = await makeUser("guru");
		const siswa = await makeUser("siswa");
		const classId = await makeClass(guru);
		await declineInvite(siswa, await inviteOk(guru, classId, "siswa"));
		await acceptInvite(siswa, await inviteOk(guru, classId, "siswa"));
		expect(await getClass(siswa, classId)).toMatchObject({ ok: true });
	});

	it("does not let a student invite", async () => {
		const { siswa, classId } = await classWithStudent();
		await makeUser("baru");
		expect(await invite(siswa, classId, InviteInput.assert({ username: "baru" }))).toEqual({
			ok: false,
			reason: "forbidden",
		});
	});
});

describe("members", () => {
	it("a teacher promotes, demotes, and removes", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		expect(await changeRole(guru, classId, siswa, "teacher")).toEqual({ ok: true });
		expect(await getClass(siswa, classId)).toMatchObject({ class: { myRole: "teacher" } });
		expect(await changeRole(guru, classId, siswa, "student")).toEqual({ ok: true });
		expect(await removeMember(guru, classId, siswa)).toEqual({ ok: true });
		expect(await getClass(siswa, classId)).toEqual({ ok: false, reason: "not_found" });
	});

	it("a student can't change roles or remove anyone, even themselves to teacher", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const forbidden = { ok: false, reason: "forbidden" };
		expect(await changeRole(siswa, classId, siswa, "teacher")).toEqual(forbidden);
		expect(await changeRole(siswa, classId, guru, "student")).toEqual(forbidden);
		expect(await removeMember(siswa, classId, guru)).toEqual(forbidden);
	});

	it("reports a target who isn't a member", async () => {
		const { guru, orang, classId } = await classWithStudent();
		expect(await removeMember(guru, classId, orang)).toEqual({
			ok: false,
			reason: "member_not_found",
		});
	});

	it("a student leaves", async () => {
		const { siswa, classId } = await classWithStudent();
		expect(await leaveClass(siswa, classId)).toEqual({ ok: true });
		expect(await listMyClasses(siswa)).toEqual([]);
	});
});

describe("the last teacher", () => {
	const lastTeacher = { ok: false, reason: "last_teacher" };

	it("can't leave, be removed, or be demoted", async () => {
		const guru = await makeUser("guru");
		const classId = await makeClass(guru);
		expect(await leaveClass(guru, classId)).toEqual(lastTeacher);
		expect(await removeMember(guru, classId, guru)).toEqual(lastTeacher);
		expect(await changeRole(guru, classId, guru, "student")).toEqual(lastTeacher);
		expect(await getClass(guru, classId)).toMatchObject({ class: { myRole: "teacher" } });
	});

	it("can leave once a second teacher exists, and then the second is the last", async () => {
		const guru = await makeUser("guru");
		const bu = await makeUser("bu_ani");
		const classId = await makeClass(guru);
		await acceptInvite(bu, await inviteOk(guru, classId, "bu_ani", "teacher"));
		expect(await leaveClass(guru, classId)).toEqual({ ok: true });
		expect(await removeMember(bu, classId, bu)).toEqual(lastTeacher);
		expect(await changeRole(bu, classId, bu, "student")).toEqual(lastTeacher);
	});

	it("stays when the only two teachers demote themselves at the same moment", async () => {
		const runs = await Promise.all(
			Array.from({ length: 8 }, async (_, i) => {
				const a = await makeUser(`guru_a${i}`);
				const b = await makeUser(`guru_b${i}`);
				const classId = await makeClass(a);
				await acceptInvite(b, await inviteOk(a, classId, `guru_b${i}`, "teacher"));
				const results = await Promise.all([
					changeRole(a, classId, a, "student"),
					changeRole(b, classId, b, "student"),
				]);
				const members = await listMembers(a, classId);
				const teachers = members.ok ? members.members.filter((m) => m.role === "teacher") : [];
				return { results, teachers: teachers.length };
			}),
		);
		for (const { results, teachers } of runs) {
			expect(teachers).toBe(1);
			expect(results).toContainEqual(lastTeacher);
		}
	});
});
