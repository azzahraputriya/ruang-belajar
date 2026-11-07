// Owns: the "Anggota" side panel of a class: its trigger, the invite form, pending invites, the member list with its role, remove, and leave actions, and what each refusal says. Not here: the member and invite rules (src/server/classes.ts) or the class page around it (src/routes/_app/kelas/$classId.tsx).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { MoreHorizontal, Users, X } from "lucide-react";
import { useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "#/components/ui/sheet";
import type { ClassRole } from "#/db/class-schema";
import type { ClassId, InviteId, UserId } from "#/db/ids";
import { ROLE_LABEL, initials } from "#/lib/class-labels";
import { Username } from "#/lib/sign-up-rules";
import {
	changeRoleFn,
	classInvitesQuery,
	inviteFn,
	leaveClassFn,
	membersQuery,
	removeMemberFn,
	revokeInviteFn,
} from "#/server/class-fns";
import type { listClassInvitesFn, listMembersFn } from "#/server/class-fns";

type ServerFn =
	| typeof inviteFn
	| typeof revokeInviteFn
	| typeof changeRoleFn
	| typeof removeMemberFn
	| typeof leaveClassFn
	| typeof listMembersFn
	| typeof listClassInvitesFn;
type Refusal = Extract<Awaited<ReturnType<ServerFn>>, { ok: false }>["reason"];

// Every reason any server function here can give. A new reason fails to compile until it has a message.
const REFUSED: Record<Refusal, string> = {
	not_found: "Kamu sudah tidak di kelas ini.",
	forbidden: "Hanya guru yang bisa melakukan ini.",
	user_not_found: "Nama pengguna tidak ditemukan.",
	already_member: "Sudah jadi anggota kelas ini.",
	already_invited: "Sudah diundang, menunggu jawaban.",
	invite_closed: "Undangan ini sudah dijawab.",
	member_not_found: "Orang ini sudah tidak di kelas.",
	last_teacher: "Kelas harus punya setidaknya satu guru.",
};
const GENERIC = "Tidak bisa sekarang. Coba lagi.";

// Server functions here return refusals instead of throwing. Throwing turns them into mutation errors,
// so each mutation handles refusals and network failures in one onError.
class Refused extends Error {
	constructor(readonly reason: Refusal) {
		super(`Server refused: ${reason}`);
	}
}
async function orThrow(pending: Promise<{ ok: true } | { ok: false; reason: Refusal }>) {
	const result = await pending;
	if (!result.ok) throw new Refused(result.reason);
}
const messageFor = (error: Error) => (error instanceof Refused ? REFUSED[error.reason] : GENERIC);

type Member = Extract<Awaited<ReturnType<typeof listMembersFn>>, { ok: true }>["members"][number];
type Confirm = { kind: "remove"; member: Member } | { kind: "leave" };

const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
// "baru saja", "5 menit yang lalu", "kemarin", "3 hari yang lalu".
function ago(date: Date) {
	const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
	if (minutes > -1) return "baru saja";
	if (minutes > -60) return rtf.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (hours > -24) return rtf.format(hours, "hour");
	return rtf.format(Math.round(hours / 24), "day");
}

// The trigger sits in the class header. The panel's lists load when it opens, not with the page.
export function MembersPanel({ cls }: { cls: { id: ClassId; myRole: ClassRole } }) {
	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button variant="ghost" size="sm" className="ml-auto shrink-0">
					<Users />
					Anggota
				</Button>
			</SheetTrigger>
			{/* The overlay's own fade targets Base UI attributes Radix never sets, so the slide is added here. */}
			<SheetContent
				side="right"
				showCloseButton={false}
				aria-describedby={undefined}
				className="gap-6 overflow-y-auto p-5 data-[side=right]:w-full data-[side=right]:sm:max-w-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-10"
			>
				<div className="flex items-center justify-between">
					<SheetTitle className="font-semibold">Anggota</SheetTitle>
					<SheetClose asChild>
						<Button size="icon-sm" variant="ghost" aria-label="Tutup">
							<X />
						</Button>
					</SheetClose>
				</div>
				<PanelBody classId={cls.id} isTeacher={cls.myRole === "teacher"} />
			</SheetContent>
		</Sheet>
	);
}

// Mounted only while the panel is open, so messages and the form reset each time it opens.
function PanelBody({ classId, isTeacher }: { classId: ClassId; isTeacher: boolean }) {
	const { user } = useRouteContext({ from: "/_app" });
	const queryClient = useQueryClient();
	const router = useRouter();
	const navigate = useNavigate();
	const members = useQuery(membersQuery(user.id, classId));
	const invites = useQuery(classInvitesQuery(user.id, classId, isTeacher));
	const [message, setMessage] = useState("");
	const [confirm, setConfirm] = useState<Confirm | null>(null);
	const listHeading = useRef<HTMLHeadingElement>(null);
	const inviteInput = useRef<HTMLInputElement>(null);
	const focusListAfterClose = useRef(false);

	// Also runs after a refusal, since one usually means someone else changed the class meanwhile.
	// The router reload updates the header's count and my role, which picks the teacher or student view.
	const refresh = (header: boolean) =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["members"] }),
			queryClient.invalidateQueries({ queryKey: ["class-invites"] }),
			header && router.invalidate(),
		]);

	const revoke = useMutation({
		mutationFn: (inviteId: InviteId) => orThrow(revokeInviteFn({ data: { inviteId } })),
		onMutate: () => setMessage(""),
		onError: (error) => setMessage(messageFor(error)),
		// The row and its button disappear, so focus goes back to the invite input.
		onSettled: () => {
			inviteInput.current?.focus();
			return refresh(false);
		},
	});

	const change = useMutation({
		mutationFn: ({ userId, role }: { userId: UserId; role: ClassRole | "remove" }) =>
			orThrow(
				role === "remove"
					? removeMemberFn({ data: { classId, userId } })
					: changeRoleFn({ data: { classId, userId, role } }),
			),
		onMutate: () => setMessage(""),
		onError: (error) => setMessage(messageFor(error)),
		onSettled: () => refresh(true),
	});

	const leave = useMutation({
		mutationFn: () => orThrow(leaveClassFn({ data: { classId } })),
		onMutate: () => setMessage(""),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["classes"] });
			await navigate({ to: "/" });
		},
		onError: (error) => setMessage(messageFor(error)),
	});

	const busy = change.isPending || leave.isPending;
	const list = members.data?.ok ? members.data.members : [];
	const pending = invites.data?.ok ? invites.data.invites : [];
	const refused = members.data?.ok === false ? REFUSED[members.data.reason] : "";
	const loadError = members.isError ? GENERIC : refused;

	function onConfirm() {
		if (!confirm) return;
		if (confirm.kind === "leave") return leave.mutate();
		// The removed row and its "⋯" button disappear, so focus moves to the list heading instead.
		focusListAfterClose.current = true;
		change.mutate({ userId: confirm.member.userId, role: "remove" });
	}

	return (
		<>
			{isTeacher ? (
				<InviteForm classId={classId} input={inviteInput} onSent={() => refresh(false)} />
			) : null}

			{isTeacher && pending.length > 0 ? (
				<section className="grid">
					<h3 className="pb-1 text-sm font-medium text-muted-foreground">
						Menunggu · {pending.length}
					</h3>
					{pending.map((p) => (
						<div key={p.id} className="flex items-center gap-3 border-b py-2.5 text-sm">
							<span className="grid min-w-0 flex-1 leading-tight">
								<span className="truncate">@{p.username}</span>
								<span className="text-xs text-muted-foreground">
									sebagai {ROLE_LABEL[p.role]} · {ago(p.createdAt)}
								</span>
							</span>
							<Button
								size="sm"
								variant="ghost"
								disabled={revoke.isPending}
								aria-label={`Batalkan undangan @${p.username}`}
								onClick={() => revoke.mutate(p.id)}
							>
								Batalkan
							</Button>
						</div>
					))}
				</section>
			) : null}

			<section className="grid">
				<h3
					ref={listHeading}
					tabIndex={-1}
					className="pb-1 text-sm font-medium text-muted-foreground outline-none"
				>
					{members.data?.ok ? `${list.length} anggota` : "Anggota"}
				</h3>
				{/* Mounted while empty, so a message is announced when it appears. */}
				<output className="block">
					{message || loadError ? (
						<p className="pb-2 text-sm text-destructive">{message || loadError}</p>
					) : null}
				</output>
				{members.isPending ? <p className="py-2.5 text-sm text-muted-foreground">Memuat…</p> : null}
				{list.map((m) => {
					const self = m.userId === user.id;
					const canManage = isTeacher || self;
					return (
						<div key={m.userId} className="flex items-center gap-3 border-b py-2.5">
							<span
								aria-hidden
								className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium"
							>
								{initials(m.name)}
							</span>
							<span className="grid min-w-0 flex-1 leading-tight">
								<span className="truncate text-sm font-medium">
									{m.name}
									{self ? <span className="font-normal text-muted-foreground"> (kamu)</span> : null}
								</span>
								<span className="truncate text-xs text-muted-foreground">@{m.username}</span>
							</span>
							<span className="text-sm text-muted-foreground">{ROLE_LABEL[m.role]}</span>
							{canManage ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button size="icon-sm" variant="ghost" aria-label={`Atur ${m.name}`}>
											<MoreHorizontal />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{isTeacher ? (
											<DropdownMenuItem
												disabled={busy}
												onSelect={() =>
													change.mutate({
														userId: m.userId,
														role: m.role === "teacher" ? "student" : "teacher",
													})
												}
											>
												{m.role === "teacher" ? "Jadikan siswa" : "Jadikan guru"}
											</DropdownMenuItem>
										) : null}
										<DropdownMenuItem
											variant="destructive"
											disabled={busy}
											onSelect={() =>
												setConfirm(self ? { kind: "leave" } : { kind: "remove", member: m })
											}
										>
											{self ? "Keluar dari kelas" : "Keluarkan"}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<span aria-hidden className="size-7 shrink-0" />
							)}
						</div>
					);
				})}
			</section>

			<AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
				<AlertDialogContent
					size="sm"
					onCloseAutoFocus={(event) => {
						if (!focusListAfterClose.current) return;
						focusListAfterClose.current = false;
						event.preventDefault();
						listHeading.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirm?.kind === "remove"
								? `Keluarkan ${confirm.member.name}?`
								: "Keluar dari kelas?"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirm?.kind === "remove"
								? "Dia perlu diundang lagi untuk kembali."
								: "Kamu perlu diundang lagi untuk kembali."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Batal</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={onConfirm}>
							{confirm?.kind === "remove" ? "Keluarkan" : "Keluar"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function InviteForm({
	classId,
	input,
	onSent,
}: {
	classId: ClassId;
	input: React.RefObject<HTMLInputElement | null>;
	onSent: () => Promise<unknown>;
}) {
	const [username, setUsername] = useState("");
	const [role, setRole] = useState<ClassRole>("student");
	const [message, setMessage] = useState("");

	const send = useMutation({
		mutationFn: (name: string) => orThrow(inviteFn({ data: { classId, username: name, role } })),
		onSuccess: () => setUsername(""),
		onError: (error) => setMessage(messageFor(error)),
		onSettled: async () => {
			input.current?.focus();
			await onSent();
		},
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const name = username.trim();
		setMessage("");
		if (!name) {
			setMessage("Isi nama pengguna.");
			input.current?.focus();
			return;
		}
		// A name that breaks the username rules can't belong to anyone, so skip the round trip.
		if (!Username.allows(name.toLowerCase())) {
			setMessage(REFUSED.user_not_found);
			input.current?.focus();
			return;
		}
		send.mutate(name);
	}

	return (
		<form className="grid gap-2" noValidate onSubmit={onSubmit}>
			<Input
				ref={input}
				value={username}
				onChange={(event) => setUsername(event.target.value)}
				placeholder="Nama pengguna"
				aria-label="Nama pengguna"
				aria-invalid={message ? true : undefined}
				aria-describedby="invite-message"
				autoComplete="off"
				autoCapitalize="none"
				spellCheck={false}
			/>
			<div className="flex gap-2">
				<Select
					value={role}
					onValueChange={(v) => setRole(v === "teacher" ? "teacher" : "student")}
				>
					<SelectTrigger className="w-28" aria-label="Peran">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="student">{ROLE_LABEL.student}</SelectItem>
						<SelectItem value="teacher">{ROLE_LABEL.teacher}</SelectItem>
					</SelectContent>
				</Select>
				<Button type="submit" className="flex-1" disabled={send.isPending}>
					Undang
				</Button>
			</div>
			<output id="invite-message" className="block">
				{message ? <p className="text-sm text-destructive">{message}</p> : null}
			</output>
		</form>
	);
}
