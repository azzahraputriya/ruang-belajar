// Owns: tests for submission file uploads, downloads, deletes, limits, and who may reach them, through the real HTTP handlers and the test uploads folder. Not here: the submission lifecycle (src/server/submissions.test.ts) or test setup (src/test/).

import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db/client";
import {
	type ClassId,
	type StepId,
	StorageKey,
	type SubmissionFileId,
	type UserId,
} from "#/db/ids";
import { submissionFile } from "#/db/submission-schema";
import { env } from "#/env";
import { storage } from "#/server/file-storage";
import { ModuleInput, StepInput, createModule, createStep, deleteStep } from "#/server/modules";
import {
	FILE_LIMITS,
	allowedType,
	contentDisposition,
	deleteFile,
	handleDownload,
	handleUpload,
	uploadFile,
} from "#/server/submission-files";
import { DraftInput, getMySubmission, saveDraft, submit } from "#/server/submissions";
import { classWithStudent, cookieFor, inviteOk, makeUser } from "#/test/fixtures";
import { acceptInvite } from "#/server/classes";

const bytesOf = (...parts: (string | number[])[]) =>
	new Uint8Array(
		parts.flatMap((p) => (typeof p === "string" ? Array.from(new TextEncoder().encode(p)) : p)),
	);

const SAMPLES = {
	pdf: ["laporan.pdf", "application/pdf", bytesOf("%PDF-1.7\n", "isi")],
	png: ["grafik.png", "image/png", bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
	jpg: ["foto.JPG", "image/jpeg", bytesOf([0xff, 0xd8, 0xff, 0xe0, 1])],
	webp: ["foto.webp", "image/webp", bytesOf("RIFF", [0, 0, 0, 0], "WEBPVP8 ")],
	docx: [
		"esai.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		bytesOf("PK", [3, 4], "isi"),
	],
	txt: ["catatan.txt", "text/plain;charset=utf-8", bytesOf("Halo, dunia ✓")],
} as const;

const pdf = (name = "laporan.pdf", body = "isi") =>
	new File([bytesOf("%PDF-1.7\n", body)], name, { type: "application/pdf" });

async function stepIn(teacher: UserId, classId: ClassId, input: StepInput) {
	const made = await createModule(teacher, classId, ModuleInput.assert({ title: "Bab 1" }));
	if (!made.ok) throw new Error(made.reason);
	const created = await createStep(teacher, made.module.id, input);
	if (!created.ok) throw new Error(created.reason);
	return created.step.id;
}

const assignment = StepInput.assert({
	kind: "assignment",
	title: "Laporan",
	content: { prompt: "Unggah laporanmu.", accepts: { text: true, files: true } },
});

async function classWithAssignment() {
	const people = await classWithStudent();
	return { ...people, stepId: await stepIn(people.guru, people.classId, assignment) };
}

// A multipart upload as a browser sends it, Content-Length included.
async function uploadRequest(stepId: string, cookie: Headers | undefined, file: File) {
	const form = new FormData();
	form.append("file", file);
	const encoded = new Response(form);
	const body = await encoded.arrayBuffer();
	const headers = new Headers(cookie);
	headers.set("content-type", encoded.headers.get("content-type") ?? "");
	headers.set("content-length", String(body.byteLength));
	return new Request(`http://localhost:3000/api/files/upload/${stepId}`, {
		method: "POST",
		headers,
		body,
	});
}

const downloadRequest = (fileId: string, cookie?: Headers) =>
	new Request(`http://localhost:3000/api/files/${fileId}`, { headers: cookie });

async function uploadOk(student: UserId, stepId: StepId, file = pdf()) {
	const result = await uploadFile(student, stepId, file);
	if (!result.ok) throw new Error(`uploadFile failed: ${result.reason}`);
	return result.file.id;
}

async function keyOf(fileId: SubmissionFileId) {
	const [row] = await db
		.select({ key: submissionFile.storageKey })
		.from(submissionFile)
		.where(eq(submissionFile.id, fileId));
	if (!row) throw new Error("no such file row");
	return row.key;
}

const filesOnDisk = async () =>
	(await readdir(env.UPLOAD_DIR).catch(() => [] as string[])).filter((name) =>
		StorageKey.allows(name),
	);

describe("file types", () => {
	it("takes each allowed type when name, declared type, and first bytes agree", () => {
		for (const [name, declared, bytes] of Object.values(SAMPLES)) {
			expect(allowedType(name, declared, bytes), name).toBeDefined();
		}
	});

	it("refuses a file when any of the three disagrees", () => {
		const [, pdfType, pdfBytes] = SAMPLES.pdf;
		const [, , pngBytes] = SAMPLES.png;
		expect(allowedType("laporan.pdf", pdfType, pngBytes)).toBeUndefined();
		expect(allowedType("laporan.png", pdfType, pdfBytes)).toBeUndefined();
		expect(allowedType("laporan.pdf", "image/png", pdfBytes)).toBeUndefined();
		expect(allowedType("laporan", pdfType, pdfBytes)).toBeUndefined();
		expect(allowedType("virus.exe", "application/x-msdownload", bytesOf("MZ"))).toBeUndefined();
		expect(allowedType("halaman.html", "text/html", bytesOf("<script>"))).toBeUndefined();
		expect(allowedType("biner.txt", "text/plain", bytesOf("a", [0], "b"))).toBeUndefined();
		expect(allowedType("biner.txt", "text/plain", bytesOf([0xff, 0xfe]))).toBeUndefined();
	});

	it("names downloads safely, keeping the real name for modern browsers", () => {
		expect(contentDisposition('lap"oran\\ ✓.pdf')).toBe(
			`attachment; filename="lap_oran_ _.pdf"; filename*=UTF-8''lap%22oran%5C%20%E2%9C%93.pdf`,
		);
	});
});

describe("uploading", () => {
	it("stores the file, starts a draft, and lets the student submit with only a file", async () => {
		const { siswa, stepId } = await classWithAssignment();
		const response = await handleUpload(
			await uploadRequest(stepId, await cookieFor("siswa"), pdf()),
			stepId,
		);
		expect(response.status).toBe(201);
		const mine = await getMySubmission(siswa, stepId);
		expect(mine.ok && mine.submission).toMatchObject({
			status: "draft",
			files: [{ filename: "laporan.pdf", mimeType: "application/pdf" }],
		});
		expect(await submit(siswa, stepId)).toMatchObject({ ok: true, changed: true });
	});

	it("enforces the size and count limits", async () => {
		const { siswa, stepId } = await classWithAssignment();
		const cookie = await cookieFor("siswa");
		const huge = new File([new Uint8Array(FILE_LIMITS.maxBytes + 1)], "besar.pdf", {
			type: "application/pdf",
		});
		expect(await uploadFile(siswa, stepId, huge)).toEqual({ ok: false, reason: "file_too_large" });
		const tooLong = await uploadRequest(stepId, cookie, pdf());
		tooLong.headers.set("content-length", String(FILE_LIMITS.maxBytes * 2));
		expect((await handleUpload(tooLong, stepId)).status).toBe(413);
		const noLength = await uploadRequest(stepId, cookie, pdf());
		noLength.headers.delete("content-length");
		expect((await handleUpload(noLength, stepId)).status).toBe(411);

		// One more than the limit, all at once: the count is taken under the class lock.
		const results = await Promise.all(
			Array.from({ length: FILE_LIMITS.perSubmission + 1 }, (_, i) =>
				uploadFile(siswa, stepId, pdf(`bagian-${i}.pdf`)),
			),
		);
		expect(results.filter((r) => r.ok)).toHaveLength(FILE_LIMITS.perSubmission);
		expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "too_many_files" }]);
		expect(await filesOnDisk()).toHaveLength(FILE_LIMITS.perSubmission);
	});

	it("refuses a disallowed type and leaves nothing on disk", async () => {
		const { stepId } = await classWithAssignment();
		const fake = new File([bytesOf("MZ")], "tugas.pdf", { type: "application/pdf" });
		const response = await handleUpload(
			await uploadRequest(stepId, await cookieFor("siswa"), fake),
			stepId,
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ ok: false, reason: "file_type_not_allowed" });
		expect(await filesOnDisk()).toEqual([]);
	});

	it("only lets the student add files while the work is theirs to change", async () => {
		const { siswa, stepId } = await classWithAssignment();
		await uploadOk(siswa, stepId);
		await submit(siswa, stepId);
		expect(await uploadFile(siswa, stepId, pdf("telat.pdf"))).toMatchObject({
			ok: false,
			reason: "wrong_status",
		});
		expect(await filesOnDisk()).toHaveLength(1);
	});

	it("refuses files on steps that take only text", async () => {
		const { guru, siswa, classId } = await classWithStudent();
		const stepId = await stepIn(
			guru,
			classId,
			StepInput.assert({ kind: "reflection", title: "Refleksi", content: { prompt: "?" } }),
		);
		expect(await uploadFile(siswa, stepId, pdf())).toEqual({
			ok: false,
			reason: "files_not_accepted",
		});
		expect(await filesOnDisk()).toEqual([]);
	});

	it("gives teachers, outsiders, and signed-out requests a 404", async () => {
		const { stepId } = await classWithAssignment();
		const cookies = [await cookieFor("guru"), await cookieFor("orang"), undefined];
		const responses = await Promise.all([
			...cookies.map(async (c) => handleUpload(await uploadRequest(stepId, c, pdf()), stepId)),
			handleUpload(await uploadRequest("x", cookies[0], pdf()), "x"),
		]);
		expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
		expect(await filesOnDisk()).toEqual([]);
	});
});

describe("downloading", () => {
	it("serves the student and the class's teachers, as an attachment", async () => {
		const { siswa, stepId } = await classWithAssignment();
		const fileId = await uploadOk(siswa, stepId, pdf("Laporan Akhir.pdf", "isi asli"));
		const responses = await Promise.all(
			["siswa", "guru"].map(async (username) => {
				const response = await handleDownload(
					downloadRequest(fileId, await cookieFor(username)),
					fileId,
				);
				return { response, body: new TextDecoder().decode(await response.arrayBuffer()) };
			}),
		);
		for (const { response, body } of responses) {
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/pdf");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("content-disposition")).toMatch(
				/^attachment; filename="Laporan Akhir.pdf"/,
			);
			expect(body).toBe("%PDF-1.7\nisi asli");
		}
	});

	it("gives another student, an outsider, and signed-out requests a 404", async () => {
		const { guru, siswa, classId, stepId } = await classWithAssignment();
		await acceptInvite(await makeUser("kedua"), await inviteOk(guru, classId, "kedua"));
		const fileId = await uploadOk(siswa, stepId);
		const owner = await cookieFor("siswa");
		const unknown = randomUUID();
		const responses = await Promise.all([
			handleDownload(downloadRequest(fileId, await cookieFor("kedua")), fileId),
			handleDownload(downloadRequest(fileId, await cookieFor("orang")), fileId),
			handleDownload(downloadRequest(fileId), fileId),
			handleDownload(downloadRequest(unknown, owner), unknown),
			handleDownload(downloadRequest("x", owner), "x"),
		]);
		expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
	});
});

describe("deleting", () => {
	it("removes the file from the draft and from disk", async () => {
		const { siswa, stepId } = await classWithAssignment();
		const fileId = await uploadOk(siswa, stepId);
		const key = await keyOf(fileId);
		expect(await storage.read(key)).toBeDefined();

		expect(await deleteFile(siswa, fileId)).toEqual({ ok: true });
		expect(await storage.read(key)).toBeUndefined();
		const mine = await getMySubmission(siswa, stepId);
		expect(mine.ok && mine.submission?.files).toEqual([]);
		expect(await deleteFile(siswa, fileId)).toEqual({ ok: false, reason: "not_found" });
	});

	it("keeps handed-in files, and other people's files are not found", async () => {
		const { guru, siswa, classId, stepId } = await classWithAssignment();
		const kedua = await makeUser("kedua");
		await acceptInvite(kedua, await inviteOk(guru, classId, "kedua"));
		const fileId = await uploadOk(siswa, stepId);
		await saveDraft(siswa, stepId, DraftInput.assert({ text: "Lihat lampiran." }));

		expect(await deleteFile(kedua, fileId)).toEqual({ ok: false, reason: "not_found" });
		expect(await deleteFile(guru, fileId)).toEqual({ ok: false, reason: "forbidden" });
		await submit(siswa, stepId);
		expect(await deleteFile(siswa, fileId)).toMatchObject({ ok: false, reason: "wrong_status" });
		expect(await storage.read(await keyOf(fileId))).toBeDefined();
	});

	it("removes uploads from disk when their step is deleted", async () => {
		const { guru, siswa, stepId } = await classWithAssignment();
		const key = await keyOf(await uploadOk(siswa, stepId));
		expect(await deleteStep(guru, stepId)).toEqual({ ok: true });
		expect(await storage.read(key)).toBeUndefined();
		expect(await filesOnDisk()).toEqual([]);
	});
});
