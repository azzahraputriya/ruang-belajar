// Owns: one discussion thread on screen, its starter and replies, with reply, edit, and delete on each post, and the messages for refused post writes. Not here: the student's discussion page (src/components/discussion-sheet.tsx), the teacher's Diskusi tab (src/components/discussion-tab.tsx), or the shared post pieces (src/components/post-parts.tsx).

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Byline, ItemMenu, WriteBox } from "#/components/post-parts";
import type { StepId } from "#/db/ids";
import { type RefusalOf, refusalMessage } from "#/lib/refused";
import {
	type Posts,
	createPostFn,
	deletePostFn,
	editPostFn,
	replyFn,
} from "#/server/discussion-fns";
import { orThrow } from "#/server/module-fns";

export type Thread = Extract<Posts, { locked: false }>["threads"][number];
type Post = Thread | Thread["replies"][number];

export const POST_REFUSED: Record<
	| RefusalOf<typeof createPostFn>
	| RefusalOf<typeof replyFn>
	| RefusalOf<typeof editPostFn>
	| RefusalOf<typeof deletePostFn>,
	string
> = {
	not_found: "Diskusi ini sudah tidak ada.",
	not_a_discussion: "Langkah ini bukan diskusi.",
	reply_to_reply: "Balasan tidak bisa dibalas.",
	deleted: "Tanggapan ini sudah dihapus.",
	answer_first: "Tulis tanggapanmu dulu.",
	forbidden: "Kamu tidak bisa mengubah tanggapan ini.",
};

// Every post write changes the threads, the teacher's counts, and maybe the student's status.
export function useRefreshDiscussion() {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["discussion"] }),
			queryClient.invalidateQueries({ queryKey: ["progress"] }),
		]);
}

function PostItem({
	post,
	teacher,
	focus,
	className = "",
}: {
	post: Post;
	// Teachers delete anyone's post. Only the author edits.
	teacher: boolean;
	// The student whose posts the teacher is reading, so theirs stand out.
	focus?: string | undefined;
	className?: string;
}) {
	const refresh = useRefreshDiscussion();
	const [editing, setEditing] = useState(false);
	const remove = useMutation({
		mutationFn: async () => orThrow(await deletePostFn({ data: { postId: post.id } })),
		onSuccess: refresh,
	});
	if (post.deleted) {
		return (
			<p className={`text-sm text-muted-foreground italic ${className}`}>Tanggapan ini dihapus.</p>
		);
	}
	const focused = focus !== undefined && post.authorId === focus;
	return (
		<div
			className={`grid gap-0.5 ${focused ? "-mx-2 rounded-md bg-primary/5 px-2 py-1" : ""} ${className}`}
		>
			<div className="flex items-start gap-2">
				<Byline
					name={post.authorName}
					mine={post.mine}
					teacher={post.teacher}
					createdAt={post.createdAt}
					editedAt={post.editedAt}
					className="flex-1"
				/>
				{editing ? null : (
					<ItemMenu
						what="tanggapan"
						label={post.authorName}
						consequence="Balasannya tetap ada. Isi dan nama penulisnya hilang."
						onEdit={post.mine ? () => setEditing(true) : undefined}
						onDelete={post.mine || teacher ? () => remove.mutate() : undefined}
					/>
				)}
			</div>
			{editing ? (
				<div className="mt-1">
					<WriteBox
						label="Ubah tanggapan"
						submitLabel="Simpan"
						initial={post.body}
						focusOnOpen
						save={async (body) => {
							orThrow(await editPostFn({ data: { postId: post.id, post: { body } } }));
							await refresh();
						}}
						refused={POST_REFUSED}
						onDone={() => setEditing(false)}
						onCancel={() => setEditing(false)}
					/>
				</div>
			) : (
				<p className="text-sm leading-6 text-pretty whitespace-pre-wrap">{post.body}</p>
			)}
			<p role="alert" className="text-sm text-destructive empty:hidden">
				{refusalMessage(remove.error, POST_REFUSED, "Tidak bisa menghapus. Coba lagi.")}
			</p>
		</div>
	);
}

export function ThreadView({
	thread,
	teacher,
	focus,
	showReplied = false,
}: {
	thread: Thread;
	teacher: boolean;
	focus?: string | undefined;
	// Students: say so when they already replied, since replying to others is what they're counting.
	showReplied?: boolean;
}) {
	return (
		<div className="grid gap-3">
			<PostItem post={thread} teacher={teacher} focus={focus} />
			{thread.replies.length > 0 ? (
				<ul className="grid gap-3 border-l-2 pl-4">
					{thread.replies.map((r) => (
						<li key={r.id}>
							<PostItem post={r} teacher={teacher} focus={focus} />
						</li>
					))}
				</ul>
			) : null}
			{/* A deleted thread takes no new replies. */}
			{thread.deleted ? null : <ReplyArea thread={thread} showReplied={showReplied} />}
		</div>
	);
}

// "Balas" under a thread, which opens a reply box in its place.
function ReplyArea({
	thread,
	showReplied,
}: {
	thread: Extract<Thread, { deleted: false }>;
	showReplied: boolean;
}) {
	const refresh = useRefreshDiscussion();
	const [replying, setReplying] = useState(false);
	if (replying) {
		return (
			<div className="border-l-2 pl-4">
				<WriteBox
					label={`Balas ${thread.authorName}`}
					placeholder="Balas…"
					submitLabel="Balas"
					minHeight="min-h-16"
					focusOnOpen
					save={async (body) => {
						orThrow(await replyFn({ data: { postId: thread.id, post: { body } } }));
						await refresh();
					}}
					refused={POST_REFUSED}
					onDone={() => setReplying(false)}
					onCancel={() => setReplying(false)}
				/>
			</div>
		);
	}
	const replied = thread.replies.some((r) => !r.deleted && r.mine);
	return (
		<div className="flex items-center gap-3 text-xs">
			<button
				type="button"
				onClick={() => setReplying(true)}
				className="rounded-sm font-medium text-muted-foreground outline-ring hover:text-foreground focus-visible:outline-2"
			>
				Balas
			</button>
			{showReplied && replied && !thread.mine ? (
				<span className="text-primary">Sudah kamu balas</span>
			) : null}
		</div>
	);
}

// Starts a thread. The student's page and the teacher's tab both use it.
export function NewThreadBox({
	stepId,
	label,
	placeholder,
	minHeight,
}: {
	stepId: StepId;
	label: string;
	placeholder: string;
	minHeight?: string;
}) {
	const refresh = useRefreshDiscussion();
	return (
		<WriteBox
			label={label}
			placeholder={placeholder}
			submitLabel="Kirim"
			minHeight={minHeight}
			save={async (body) => {
				orThrow(await createPostFn({ data: { stepId, post: { body } } }));
				await refresh();
			}}
			refused={POST_REFUSED}
		/>
	);
}
