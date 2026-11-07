// Owns: the server functions the discussion step screen calls, which find the signed-in user and parse input. Not here: the post rules themselves (src/server/discussions.ts).

import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { PostId, StepId } from "#/db/ids";
import { requireActor } from "#/server/class-fns";
import {
	PostInput,
	createPost,
	deletePost,
	editPost,
	listPosts,
	reply,
} from "#/server/discussions";

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
