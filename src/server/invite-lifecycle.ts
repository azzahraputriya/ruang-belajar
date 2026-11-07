// Owns: the invite lifecycle table and the pure decision of whether a move is allowed. Not here: reading or writing invites (src/server/classes.ts).

import type { ClassRole, InviteStatus } from "#/db/class-schema";

export type InviteAction = "accept" | "decline" | "revoke";

// How the acting user relates to one invite. The invitee wins over any class role.
export type InviteRelation = "invitee" | ClassRole | "none";

// Same table as docs/data-model.md. Every move starts from pending.
export const INVITE_TRANSITIONS = {
	accept: { from: "pending", to: "accepted", by: "invitee" },
	decline: { from: "pending", to: "declined", by: "invitee" },
	revoke: { from: "pending", to: "revoked", by: "teacher" },
} as const satisfies Record<
	InviteAction,
	{ from: InviteStatus; to: InviteStatus; by: InviteRelation }
>;

export type InviteDecision =
	| { ok: true; to: InviteStatus; changed: boolean }
	| { ok: false; reason: "not_found" | "forbidden" | "invite_closed" };

// Repeating a move that already happened succeeds with `changed: false`, so a double click or retry is harmless.
// Any other move out of a closed invite is refused, e.g. accepting after a decline or a revoke.
export function decideInvite(
	action: InviteAction,
	status: InviteStatus,
	relation: InviteRelation,
): InviteDecision {
	// People outside the class who weren't invited learn nothing, not even that the invite exists.
	if (relation === "none") return { ok: false, reason: "not_found" };
	const rule = INVITE_TRANSITIONS[action];
	if (relation !== rule.by) return { ok: false, reason: "forbidden" };
	if (status === rule.to) return { ok: true, to: rule.to, changed: false };
	if (status !== rule.from) return { ok: false, reason: "invite_closed" };
	return { ok: true, to: rule.to, changed: true };
}
