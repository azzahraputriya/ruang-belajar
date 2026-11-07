// Owns: helpers that build users, signed-in cookies, and classes for database tests. Not here: per-test cleanup (src/test/setup.ts).

import { type ClassId, UserId } from "#/db/ids";
import { auth, signUp } from "#/server/auth";
import { CreateClassInput, InviteInput, acceptInvite, createClass, invite } from "#/server/classes";

const PASSWORD = "rahasia-123";

export async function makeUser(username: string, name = username) {
	const { response } = await signUp({ username, name, password: PASSWORD });
	return UserId.assert(response.user.id);
}

// The Cookie header a browser would send back after these Set-Cookie headers.
export function cookiesFrom(headers: Headers) {
	const cookie = headers
		.getSetCookie()
		.map((line) => line.split(";")[0])
		.join("; ");
	return new Headers({ cookie });
}

// A signed-in browser's Cookie header for a user made by makeUser.
export async function cookieFor(username: string) {
	const { headers } = await auth.api.signInUsername({
		body: { username, password: PASSWORD },
		returnHeaders: true,
	});
	return cookiesFrom(headers);
}

export async function makeClass(teacher: UserId, title = "Fisika X-1") {
	const result = await createClass(teacher, CreateClassInput.assert({ title, subject: "Fisika" }));
	return result.class.id;
}

export async function inviteOk(
	teacher: UserId,
	classId: ClassId,
	username: string,
	role?: "teacher",
) {
	const result = await invite(
		teacher,
		classId,
		InviteInput.assert({ username, ...(role && { role }) }),
	);
	if (!result.ok) throw new Error(`invite failed: ${result.reason}`);
	return result.inviteId;
}

// A teacher, a student who joined by invite, and an outsider. Usernames get `prefix` so one test can build two classes.
export async function classWithStudent(prefix = "") {
	const guru = await makeUser(`${prefix}guru`);
	const siswa = await makeUser(`${prefix}siswa`);
	const orang = await makeUser(`${prefix}orang`);
	const classId = await makeClass(guru);
	await acceptInvite(siswa, await inviteOk(guru, classId, `${prefix}siswa`));
	return { guru, siswa, orang, classId };
}
