// Owns: the server functions and queries the discussion screens call, which find the signed-in user and parse input. Not here: the post rules themselves (src/server/discussions.ts).

import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { PostId, StepId } from "#/db/ids";
import { requireActor } from "#/server/class-fns";
import {
	PostInput,
	createPost,
	deletePost,
	discussionProgress,
	editPost,
	listPosts,
	reply,
} from "#/server/discussions";
import { retry } from "#/server/module-fns";

const ForStep = type({ stepId: StepId });
const ForPost = type({ postId: PostId });

export const listPostsFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => listPosts(await requireActor(), data.stepId));

// Post fields sit under `post`, because PostInput trims (a morph) and ArkType's merge only takes plain objects.
export const createPostFn = createServerFn({ method: "POST" })
	.validator(ForStep.merge({ post: PostInput }))
	.handler(async ({ data }) => createPost(await requireActor(), data.stepId, data.post));

export const replyFn = createServerFn({ method: "POST" })
	.validator(ForPost.merge({ post: PostInput }))
	.handler(async ({ data }) => reply(await requireActor(), data.postId, data.post));

export const editPostFn = createServerFn({ method: "POST" })
	.validator(ForPost.merge({ post: PostInput }))
	.handler(async ({ data }) => editPost(await requireActor(), data.postId, data.post));

export const deletePostFn = createServerFn({ method: "POST" })
	.validator(ForPost)
	.handler(async ({ data }) => deletePost(await requireActor(), data.postId));

export const discussionProgressFn = createServerFn()
	.validator(ForStep)
	.handler(async ({ data }) => discussionProgress(await requireActor(), data.stepId));

// Both sit under ["discussion", userId, stepId], so one invalidation after a post refreshes the
// threads and the teacher's counts.
export const postsQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["discussion", userId, stepId],
		retry,
		queryFn: async () => {
			const result = await listPostsFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result;
		},
	});

export const discussionProgressQuery = (userId: string, stepId: StepId) =>
	queryOptions({
		queryKey: ["discussion", userId, stepId, "progress"],
		retry,
		queryFn: async () => {
			const result = await discussionProgressFn({ data: { stepId } });
			if (!result.ok) throw notFound();
			return result.students;
		},
	});
export type Posts = Extract<Awaited<ReturnType<typeof listPosts>>, { ok: true }>;
