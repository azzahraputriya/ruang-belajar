// Owns: tests for discussion steps (posting, replying, editing, deleting, reading threads) and the discussion status rule, against the test database. Not here: announcements (src/server/announcements.test.ts) or test setup (src/test/).

import { type } from "arktype";
import { describe, expect, it } from "vitest";
import type { ClassId, PostId, StepId, UserId } from "#/db/ids";
import { acceptInvite } from "#/server/classes";
import {
	PostInput,
	createPost,
	deletePost,
	editPost,
	listPosts,
	reply,
} from "#/server/discussions";
import {
	ModuleInput,
	StepInput,
	classProgress,
	createModule,
	createStep,
	progressFor,
	recordVisit,
} from "#/server/modules";
import { classWithStudent, inviteOk, makeUser } from "#/test/fixtures";

const body = (text: string) => PostInput.assert({ body: text });

const discussion = (content: Record<string, unknown> = {}) =>
	StepInput({ kind: "discussion", title: "Diskusi", content: { prompt: "Bahas.", ...content } });

async function stepIn(teacher: UserId, classId: ClassId, content = {}, opensAt?: Date) {
	const created = await createModule(
		teacher,
		classId,
		ModuleInput.assert({ title: "Bab 1", ...(opensAt && { opensAt }) }),
	);
	if (!created.ok) throw new Error(`createModule failed: ${created.reason}`);
	const made = await createStep(teacher, created.module.id, StepInput.assert(discussion(content)));
	if (!made.ok) throw new Error(`createStep failed: ${made.reason}`);
	return made.step.id;
}

// A class with a teacher, two students, an outsider, and one discussion step.
async function classWithDiscussion(content = {}) {
	const people = await classWithStudent();
	const teman = await makeUser("teman", "Teman Sekelas");
	await acceptInvite(teman, await inviteOk(people.guru, people.classId, "teman"));
	const stepId = await stepIn(people.guru, people.classId, content);
	return { ...people, teman, stepId };
}

async function postOk(actor: UserId, stepId: StepId, text = "Pendapatku.") {
	const result = await createPost(actor, stepId, body(text));
	if (!result.ok) throw new Error(`createPost failed: ${result.reason}`);
	return result.postId;
}

async function replyOk(actor: UserId, parentId: PostId, text = "Setuju.") {
	const result = await reply(actor, parentId, body(text));
	if (!result.ok) throw new Error(`reply failed: ${result.reason}`);
	return result.postId;
}

async function statusOf(student: UserId, classId: ClassId, stepId: StepId) {
	const result = await progressFor(student, classId);
	if (!result.ok) throw new Error(`progressFor failed: ${result.reason}`);
	return result.progress.find((p) => p.stepId === stepId)?.status;
}

async function threadsOf(actor: UserId, stepId: StepId) {
	const result = await listPosts(actor, stepId);
	if (!result.ok) throw new Error(`listPosts failed: ${result.reason}`);
	return result.threads;
}

describe("discussion content", () => {
	it("defaults to one post and no replies", () => {
		const parsed = discussion();
		if (parsed instanceof type.errors || !("content" in parsed)) throw new Error("did not parse");
		expect(parsed.content).toEqual({ prompt: "Bahas.", requiredPosts: 1, requiredReplies: 0 });
	});

	it("refuses requiring nothing, and more than 10 of either", () => {
		expect(discussion({ requiredPosts: 0, requiredReplies: 0 })).toBeInstanceOf(type.errors);
		expect(discussion({ requiredPosts: 11 })).toBeInstanceOf(type.errors);
		expect(discussion({ requiredReplies: 11 })).toBeInstanceOf(type.errors);
		expect(discussion({ requiredPosts: 0, requiredReplies: 1 })).not.toBeInstanceOf(type.errors);
	});

	it("refuses a blank or too long post", () => {
		expect(PostInput({ body: "   " })).toBeInstanceOf(type.errors);
		expect(PostInput({ body: "a".repeat(10001) })).toBeInstanceOf(type.errors);
		expect(PostInput({ body: "a".repeat(10000) })).not.toBeInstanceOf(type.errors);
	});
});

describe("discussion status", () => {
	it("is done exactly when the required posts and replies are met", async () => {
		const { guru, siswa, teman, classId, stepId } = await classWithDiscussion({
			requiredPosts: 1,
			requiredReplies: 2,
		});
		expect(await statusOf(siswa, classId, stepId)).toBe("not_started");
		await recordVisit(siswa, stepId, "opened");
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		await postOk(siswa, stepId);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		const theirs = await postOk(teman, stepId);
		await replyOk(siswa, theirs);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
		await replyOk(siswa, theirs);
		expect(await statusOf(siswa, classId, stepId)).toBe("done");

		const progress = await classProgress(guru, classId);
		if (!progress.ok) throw new Error(progress.reason);
		const statusFor = (id: UserId) =>
			progress.students.find((s) => s.userId === id)?.progress.find((p) => p.stepId === stepId)
				?.status;
		expect(statusFor(siswa)).toBe("done");
		// Teman posted but replied to nobody.
		expect(statusFor(teman)).toBe("in_progress");
	});

	it("counts a post with no visit, and replies alone when no post is required", async () => {
		const { siswa, teman, classId, stepId } = await classWithDiscussion({
			requiredPosts: 0,
			requiredReplies: 1,
		});
		expect(await statusOf(siswa, classId, stepId)).toBe("not_started");
		await replyOk(siswa, await postOk(teman, stepId));
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("doesn't count replies to your own thread", async () => {
		const { siswa, classId, stepId } = await classWithDiscussion({ requiredReplies: 1 });
		const own = await postOk(siswa, stepId);
		await replyOk(siswa, own);
		await replyOk(siswa, own);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
	});

	it("counts a reply to a teacher's thread", async () => {
		const { guru, siswa, classId, stepId } = await classWithDiscussion({ requiredReplies: 1 });
		await postOk(siswa, stepId);
		await replyOk(siswa, await postOk(guru, stepId));
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("stops counting a deleted post or reply", async () => {
		const { guru, siswa, teman, classId, stepId } = await classWithDiscussion({
			requiredReplies: 1,
		});
		const own = await postOk(siswa, stepId);
		const answer = await replyOk(siswa, await postOk(teman, stepId));
		expect(await statusOf(siswa, classId, stepId)).toBe("done");

		await deletePost(siswa, answer);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");

		await replyOk(siswa, await postOk(teman, stepId));
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
		await deletePost(guru, own);
		expect(await statusOf(siswa, classId, stepId)).toBe("in_progress");
	});

	it("keeps counting a reply after its thread is deleted", async () => {
		const { siswa, teman, classId, stepId } = await classWithDiscussion({
			requiredPosts: 0,
			requiredReplies: 1,
		});
		const theirs = await postOk(teman, stepId);
		await replyOk(siswa, theirs);
		await deletePost(teman, theirs);
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
	});

	it("counts a reply only on its own step", async () => {
		const { guru, siswa, teman, classId, stepId } = await classWithDiscussion({
			requiredPosts: 0,
			requiredReplies: 1,
		});
		const other = await stepIn(guru, classId, { requiredPosts: 0, requiredReplies: 1 });
		await replyOk(siswa, await postOk(teman, stepId));
		expect(await statusOf(siswa, classId, stepId)).toBe("done");
		expect(await statusOf(siswa, classId, other)).toBe("not_started");
		const [thread] = await threadsOf(siswa, stepId);
		expect(thread?.replies).toHaveLength(1);
		expect(await threadsOf(siswa, other)).toEqual([]);
	});
});

describe("replies", () => {
	it("are one level deep", async () => {
		const { siswa, teman, stepId } = await classWithDiscussion();
		const answer = await replyOk(siswa, await postOk(teman, stepId));
		expect(await reply(teman, answer, body("Balasan ke balasan."))).toEqual({
			ok: false,
			reason: "reply_to_reply",
		});
	});

	it("are refused on a deleted thread", async () => {
		const { siswa, teman, stepId } = await classWithDiscussion();
		const theirs = await postOk(teman, stepId);
		await deletePost(teman, theirs);
		expect(await reply(siswa, theirs, body("Halo?"))).toEqual({ ok: false, reason: "deleted" });
	});
});

describe("editing and deleting", () => {
	it("lets only the author edit", async () => {
		const { guru, siswa, teman, stepId } = await classWithDiscussion();
		const own = await postOk(siswa, stepId, "Versi awal.");
		const forbidden = { ok: false, reason: "forbidden" };
		expect(await editPost(teman, own, body("Diubah teman."))).toEqual(forbidden);
		expect(await editPost(guru, own, body("Diubah guru."))).toEqual(forbidden);

		expect(await editPost(siswa, own, body("Versi baru."))).toEqual({ ok: true });
		const [thread] = await threadsOf(teman, stepId);
		if (!thread || thread.deleted) throw new Error("thread missing");
		expect(thread.body).toBe("Versi baru.");
		expect(thread.editedAt).toBeInstanceOf(Date);
	});

	it("refuses editing a deleted post", async () => {
		const { siswa, stepId } = await classWithDiscussion();
		const own = await postOk(siswa, stepId);
		await deletePost(siswa, own);
		expect(await editPost(siswa, own, body("Lagi."))).toEqual({ ok: false, reason: "deleted" });
	});

	it("lets the author or a teacher delete, not another student", async () => {
		const { guru, siswa, teman, stepId } = await classWithDiscussion();
		const first = await postOk(siswa, stepId);
		const second = await postOk(siswa, stepId);
		expect(await deletePost(teman, first)).toEqual({ ok: false, reason: "forbidden" });
		expect(await deletePost(siswa, first)).toEqual({ ok: true });
		expect(await deletePost(siswa, first)).toEqual({ ok: true });
		expect(await deletePost(guru, second)).toEqual({ ok: true });
		const threads = await threadsOf(teman, stepId);
		expect(threads.map((t) => t.deleted)).toEqual([true, true]);
	});

	it("hides a deleted post's body and author but keeps its replies", async () => {
		const { siswa, teman, stepId } = await classWithDiscussion();
		const own = await postOk(siswa, stepId, "Rahasia.");
		await replyOk(teman, own, "Balasan.");
		await deletePost(siswa, own);
		const [thread] = await threadsOf(teman, stepId);
		if (!thread) throw new Error("thread missing");
		const { replies, ...deleted } = thread;
		expect(new Set(Object.keys(deleted))).toEqual(new Set(["id", "createdAt", "deleted"]));
		expect(deleted.id).toBe(own);
		expect(deleted.deleted).toBe(true);
		expect(replies.map((r) => !r.deleted && [r.authorName, r.body, r.mine])).toEqual([
			["Teman Sekelas", "Balasan.", true],
		]);
	});
});

describe("reading threads", () => {
	it("lists threads and replies oldest first, with only the author's display name", async () => {
		const { guru, siswa, teman, stepId } = await classWithDiscussion();
		const first = await postOk(siswa, stepId, "Satu.");
		await postOk(teman, stepId, "Dua.");
		await replyOk(teman, first, "Satu-a.");
		await replyOk(guru, first, "Satu-b.");

		const threads = await threadsOf(siswa, stepId);
		expect(threads.map((t) => !t.deleted && t.body)).toEqual(["Satu.", "Dua."]);
		const [thread] = threads;
		if (!thread || thread.deleted) throw new Error("thread missing");
		expect(new Set(Object.keys(thread))).toEqual(
			new Set(["id", "createdAt", "deleted", "mine", "authorName", "body", "editedAt", "replies"]),
		);
		expect(thread.mine).toBe(true);
		expect(thread.replies.map((r) => !r.deleted && [r.authorName, r.body, r.mine])).toEqual([
			["Teman Sekelas", "Satu-a.", false],
			["guru", "Satu-b.", false],
		]);
	});

	it("refuses a step that isn't a discussion", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const created = await createModule(guru, classId, ModuleInput.assert({ title: "Bab 1" }));
		if (!created.ok) throw new Error(created.reason);
		const made = await createStep(
			guru,
			created.module.id,
			StepInput.assert({ kind: "reading", title: "Bacaan", content: { body: "Isi." } }),
		);
		if (!made.ok) throw new Error(made.reason);
		const notDiscussion = { ok: false, reason: "not_a_discussion" };
		expect(await listPosts(siswa, made.step.id)).toEqual(notDiscussion);
		expect(await createPost(siswa, made.step.id, body("Halo."))).toEqual(notDiscussion);
	});
});

describe("who can see a discussion", () => {
	const notFound = { ok: false, reason: "not_found" };

	it("gives someone outside the class nothing", async () => {
		const { siswa, orang, stepId } = await classWithDiscussion();
		const own = await postOk(siswa, stepId);
		expect(await listPosts(orang, stepId)).toEqual(notFound);
		expect(await createPost(orang, stepId, body("Masuk."))).toEqual(notFound);
		expect(await reply(orang, own, body("Masuk."))).toEqual(notFound);
		expect(await editPost(orang, own, body("Masuk."))).toEqual(notFound);
		expect(await deletePost(orang, own)).toEqual(notFound);
	});

	it("hides a module that hasn't opened from students, not from teachers", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
		const stepId = await stepIn(guru, classId, {}, later);
		const guruPost = await postOk(guru, stepId);
		expect(await threadsOf(guru, stepId)).toHaveLength(1);
		expect(await listPosts(siswa, stepId)).toEqual(notFound);
		expect(await createPost(siswa, stepId, body("Halo."))).toEqual(notFound);
		expect(await reply(siswa, guruPost, body("Halo."))).toEqual(notFound);
	});
});
