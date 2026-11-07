// Owns: the server functions the class screens call, which find the signed-in user and parse input, the queries that cache them in the browser, plus the last-opened-class cookie. Not here: the class rules themselves (src/server/classes.ts).

import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { type } from "arktype";
import { ClassId, InviteId, UserId } from "#/db/ids";
import { env } from "#/env";
import { auth } from "#/server/auth";
import {
	ClassRoleInput,
	CreateClassInput,
	InviteInput,
	acceptInvite,
	changeRole,
	createClass,
	declineInvite,
	getClass,
	invite,
	leaveClass,
	listClassInvites,
	listMembers,
	listMyClasses,
	listMyPendingInvites,
	removeMember,
	revokeInvite,
} from "#/server/classes";

// Screens that call these sit behind sign-in, so a missing session is a bug, not an expected result.
async function requireActor() {
	const session = await auth.api.getSession({ headers: getRequest().headers });
	if (!session) throw new Error("Not signed in");
	return UserId.assert(session.user.id);
}

const InClass = type({ classId: ClassId });
const ForInvite = type({ inviteId: InviteId });
const ForMember = type({ classId: ClassId, userId: UserId });

export const createClassFn = createServerFn({ method: "POST" })
	.validator(CreateClassInput)
	.handler(async ({ data }) => createClass(await requireActor(), data));

export const listMyClassesFn = createServerFn().handler(async () =>
	listMyClasses(await requireActor()),
);

export const listMyPendingInvitesFn = createServerFn().handler(async () =>
	listMyPendingInvites(await requireActor()),
);

export const getClassFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => getClass(await requireActor(), data.classId));

export const listMembersFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => listMembers(await requireActor(), data.classId));

export const listClassInvitesFn = createServerFn()
	.validator(InClass)
	.handler(async ({ data }) => listClassInvites(await requireActor(), data.classId));

export const inviteFn = createServerFn({ method: "POST" })
	.validator(InviteInput.merge({ classId: ClassId }))
	.handler(async ({ data: { classId, ...input } }) => invite(await requireActor(), classId, input));

export const acceptInviteFn = createServerFn({ method: "POST" })
	.validator(ForInvite)
	.handler(async ({ data }) => acceptInvite(await requireActor(), data.inviteId));

export const declineInviteFn = createServerFn({ method: "POST" })
	.validator(ForInvite)
	.handler(async ({ data }) => declineInvite(await requireActor(), data.inviteId));

export const revokeInviteFn = createServerFn({ method: "POST" })
	.validator(ForInvite)
	.handler(async ({ data }) => revokeInvite(await requireActor(), data.inviteId));

export const changeRoleFn = createServerFn({ method: "POST" })
	.validator(ForMember.merge({ role: ClassRoleInput }))
	.handler(async ({ data }) =>
		changeRole(await requireActor(), data.classId, data.userId, data.role),
	);

export const removeMemberFn = createServerFn({ method: "POST" })
	.validator(ForMember)
	.handler(async ({ data }) => removeMember(await requireActor(), data.classId, data.userId));

export const leaveClassFn = createServerFn({ method: "POST" })
	.validator(InClass)
	.handler(async ({ data }) => leaveClass(await requireActor(), data.classId));

const LAST_CLASS_COOKIE = "last-class";

// The cookie is only a hint. A junk value or a class you've left gives null, never an error.
export const getLastClassFn = createServerFn().handler(async () => {
	const actor = await requireActor();
	const classId = ClassId(getCookie(LAST_CLASS_COOKIE));
	if (classId instanceof type.errors) return null;
	const found = await getClass(actor, classId);
	return found.ok ? found.class : null;
});

export const setLastClassFn = createServerFn({ method: "POST" })
	.validator(InClass)
	.handler(async ({ data }) => {
		const found = await getClass(await requireActor(), data.classId);
		if (!found.ok) return found;
		setCookie(LAST_CLASS_COOKIE, data.classId, {
			httpOnly: true,
			sameSite: "lax",
			secure: env.BETTER_AUTH_URL.startsWith("https:"),
			path: "/",
			maxAge: 60 * 60 * 24 * 365,
		});
		return { ok: true } as const;
	});

// Keyed by user, so whoever signs in next in this tab never sees the last user's cached classes.
// Invalidate with the bare prefix: ["classes"], ["invites"], ["members"], or ["class-invites"].
export const myClassesQuery = (userId: string) =>
	queryOptions({
		queryKey: ["classes", userId],
		queryFn: () => listMyClassesFn(),
	});

export const myInvitesQuery = (userId: string) =>
	queryOptions({
		queryKey: ["invites", userId],
		queryFn: () => listMyPendingInvitesFn(),
	});

export const membersQuery = (userId: string, classId: ClassId) =>
	queryOptions({
		queryKey: ["members", userId, classId],
		queryFn: () => listMembersFn({ data: { classId } }),
	});

// Students get "forbidden" from the server, so screens enable this for teachers only.
export const classInvitesQuery = (userId: string, classId: ClassId, enabled: boolean) =>
	queryOptions({
		queryKey: ["class-invites", userId, classId],
		queryFn: () => listClassInvitesFn({ data: { classId } }),
		enabled,
	});
