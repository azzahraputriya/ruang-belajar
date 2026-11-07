// Owns: the pending-invite banner with Tolak and Terima, and which invite it shows (shared with the rail's invite tiles). Not here: the invite rules (src/server/classes.ts) or the rail (src/components/class-rail.tsx).

import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "#/components/ui/button";
import type { InviteId } from "#/db/ids";
import { ROLE_LABEL } from "#/lib/class-labels";
import { acceptInviteFn, declineInviteFn, myInvitesQuery } from "#/server/class-fns";

type InviteFocus = {
	chosenId: InviteId | null;
	show: (id: InviteId) => void;
	bannerRef: React.RefObject<HTMLElement | null>;
};
const InviteFocusContext = createContext<InviteFocus | null>(null);

// Wraps the signed-in shell, so a rail tile can pick the invite the banner on the current page shows.
export function InviteFocusProvider({ children }: { children: React.ReactNode }) {
	const [chosenId, setChosenId] = useState<InviteId | null>(null);
	const bannerRef = useRef<HTMLElement>(null);
	const value = useMemo(
		() => ({
			chosenId,
			bannerRef,
			show: (id: InviteId) => {
				flushSync(() => setChosenId(id));
				bannerRef.current?.focus();
			},
		}),
		[chosenId],
	);
	return <InviteFocusContext value={value}>{children}</InviteFocusContext>;
}

export function useShowInvite() {
	const focus = useContext(InviteFocusContext);
	if (!focus) throw new Error("useShowInvite needs an InviteFocusProvider above it");
	return focus.show;
}

type Answer = { inviteId: InviteId; accept: boolean };

export function InviteBanner() {
	const focus = useContext(InviteFocusContext);
	const { data: invites } = useSuspenseQuery(myInvitesQuery);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [error, setError] = useState("");

	// The chosen invite can be gone after an answer, so fall back to the newest one.
	const invite = invites.find((i) => i.id === focus?.chosenId) ?? invites[0];

	const answer = useMutation({
		mutationFn: ({ inviteId, accept }: Answer) =>
			(accept ? acceptInviteFn : declineInviteFn)({ data: { inviteId } }),
		onMutate: () => setError(""),
		onSuccess: async (result, { accept }) => {
			await queryClient.invalidateQueries({ queryKey: ["invites"] });
			// A teacher can revoke the invite while it sits on screen.
			if (!result.ok) {
				setError("Undangan itu sudah tidak berlaku.");
				return;
			}
			if (!accept) return;
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			await navigate({ to: "/kelas/$classId", params: { classId: result.classId } });
		},
		onError: () => setError("Tidak bisa menjawab undangan sekarang. Coba lagi."),
	});

	return (
		<>
			{/* Mounted while empty, so the message is announced when it appears. */}
			<output className="block">
				{error ? <p className="mx-4 mt-4 text-sm text-destructive sm:mx-6">{error}</p> : null}
			</output>
			{invite ? (
				<section
					ref={focus?.bannerRef}
					tabIndex={-1}
					aria-label="Undangan kelas"
					className="mx-4 mt-4 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm outline-ring focus-visible:outline-2 sm:mx-6 sm:flex-row sm:items-center sm:gap-3"
				>
					<p className="flex-1 text-pretty">
						<b className="font-medium">@{invite.invitedBy}</b> mengundangmu ke{" "}
						<b className="font-medium">{invite.classTitle}</b> sebagai{" "}
						{ROLE_LABEL[invite.role].toLowerCase()}.
					</p>
					<div className="flex justify-end gap-2">
						<Button
							size="sm"
							variant="ghost"
							disabled={answer.isPending}
							onClick={() => answer.mutate({ inviteId: invite.id, accept: false })}
						>
							Tolak
						</Button>
						<Button
							size="sm"
							disabled={answer.isPending}
							onClick={() => answer.mutate({ inviteId: invite.id, accept: true })}
						>
							Terima
						</Button>
					</div>
				</section>
			) : null}
		</>
	);
}
