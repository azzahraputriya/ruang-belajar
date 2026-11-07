// Owns: files handed in with a submission, meaning the size, count, and type limits, who may upload, download, or delete one, and the HTTP handlers the /api/files routes call. Not here: where the bytes live (src/server/file-storage.ts) or the lifecycle (src/server/submission-lifecycle.ts).

import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { count, eq } from "drizzle-orm";
import { db } from "#/db/client";
import { StepId, StorageKey, SubmissionFileId, UserId } from "#/db/ids";
import { submission, submissionFile } from "#/db/submission-schema";
import { auth } from "#/server/auth";
import { NOT_FOUND, fail } from "#/server/class-access";
import { removeLeftovers, storage } from "#/server/file-storage";
import { stepFor } from "#/server/modules";
import { decideSubmission } from "#/server/submission-lifecycle";
import { ownSubmission, writeOwn } from "#/server/submissions";

export const FILE_LIMITS = { maxBytes: 10 * 1024 * 1024, perSubmission: 5 } as const;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
	prefix.every((b, i) => bytes[at + i] === b);
const ascii = (text: string) => Array.from(new TextEncoder().encode(text));

const PDF = ascii("%PDF-");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = ascii("PK\x03\x04");
const isUtf8Text = (bytes: Uint8Array) => {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
};

// Every file type we take, by extension: the type the browser must declare, and a check of the first
// bytes. A file must pass all three. Office files are zip archives, so their check is only "a zip".
const FILE_TYPES: Record<string, { mime: string; looksRight: (bytes: Uint8Array) => boolean }> = {
	pdf: { mime: "application/pdf", looksRight: (b) => startsWith(b, PDF) },
	png: { mime: "image/png", looksRight: (b) => startsWith(b, PNG) },
	jpg: { mime: "image/jpeg", looksRight: (b) => startsWith(b, JPEG) },
	jpeg: { mime: "image/jpeg", looksRight: (b) => startsWith(b, JPEG) },
	webp: {
		mime: "image/webp",
		looksRight: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
	},
	docx: {
		mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		looksRight: (b) => startsWith(b, ZIP),
	},
	xlsx: {
		mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		looksRight: (b) => startsWith(b, ZIP),
	},
	pptx: {
		mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		looksRight: (b) => startsWith(b, ZIP),
	},
	txt: { mime: "text/plain", looksRight: isUtf8Text },
};

// The name shown back to people. Only the last path part, without control characters or the
// direction marks that can make "rpt.exe.pdf" read as something else.
export function cleanFilename(name: string) {
	const base = (name.split(/[/\\]/).pop() ?? "")
		// oxlint-disable-next-line no-control-regex -- Stripping control characters is the point.
		.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
		.trim();
	return base.slice(-200) || "berkas";
}

// The stored type of an allowed file, or undefined. Declared type, extension, and first bytes must agree.
export function allowedType(filename: string, declared: string, bytes: Uint8Array) {
	const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() : undefined;
	const spec = extension === undefined ? undefined : FILE_TYPES[extension];
	const mime = declared.split(";")[0]?.trim().toLowerCase();
	if (!spec || mime !== spec.mime || !spec.looksRight(bytes)) return undefined;
	return spec.mime;
}

// Adds a file to the acting student's submission on the step, starting a draft if there is none.
// The bytes go to storage before the transaction, so no disk write runs under the class lock.
// When the transaction refuses or fails, the bytes are removed again.
export async function uploadFile(actor: UserId, stepId: StepId, file: File) {
	if (file.size > FILE_LIMITS.maxBytes) return fail("file_too_large");
	// A first check without the lock, so people who may not upload here never get bytes onto disk.
	// The transaction checks again under the lock.
	const early = await ownSubmission(db, actor, stepId);
	if (!early.ok) return early;
	if (!early.accepts.files) return fail("files_not_accepted");
	const filename = cleanFilename(file.name);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const mimeType = allowedType(filename, file.type, bytes);
	if (!mimeType) return fail("file_type_not_allowed");

	const key = StorageKey.assert(randomUUID());
	await storage.put(key, bytes);
	try {
		const result = await db.transaction(async (tx) => {
			const access = await writeOwn(tx, actor, stepId);
			if (!access.ok) return access;
			if (!access.accepts.files) return fail("files_not_accepted");
			let row = access.row;
			if (row) {
				const decision = decideSubmission("save", row.status, "student");
				if (!decision.ok) return { ...fail(decision.reason), status: row.status };
			} else {
				[row] = await tx.insert(submission).values({ stepId, studentId: actor }).returning();
				if (!row) throw new Error("Starting a draft returned no row");
			}
			const [{ files } = { files: 0 }] = await tx
				.select({ files: count() })
				.from(submissionFile)
				.where(eq(submissionFile.submissionId, row.id));
			if (files >= FILE_LIMITS.perSubmission) return fail("too_many_files");
			await tx.update(submission).set({ updatedAt: new Date() }).where(eq(submission.id, row.id));
			const [created] = await tx
				.insert(submissionFile)
				.values({ submissionId: row.id, storageKey: key, filename, mimeType, size: bytes.length })
				.returning({
					id: submissionFile.id,
					filename: submissionFile.filename,
					mimeType: submissionFile.mimeType,
					size: submissionFile.size,
					uploadedAt: submissionFile.uploadedAt,
				});
			if (!created) throw new Error("Inserting a file returned no row");
			return { ok: true, file: created } as const;
		});
		if (!result.ok) await removeLeftovers([key]);
		return result;
	} catch (error) {
		await removeLeftovers([key]);
		throw error;
	}
}

// Removes a file from the student's own submission while it is theirs to change, then its bytes.
export async function deleteFile(actor: UserId, fileId: SubmissionFileId) {
	const done = await db.transaction(async (tx) => {
		const [found] = await tx
			.select({ stepId: submission.stepId, studentId: submission.studentId })
			.from(submissionFile)
			.innerJoin(submission, eq(submission.id, submissionFile.submissionId))
			.where(eq(submissionFile.id, fileId));
		if (!found) return NOT_FOUND;
		const access = await writeOwn(tx, actor, found.stepId);
		if (!access.ok) return access;
		// Someone else's file is not found, the same as no file at all.
		if (!access.row || found.studentId !== actor) return NOT_FOUND;
		const decision = decideSubmission("save", access.row.status, "student");
		if (!decision.ok) return { ...fail(decision.reason), status: access.row.status };
		// Deleted under the lock, so a parallel delete of the same file finds nothing.
		const [deleted] = await tx
			.delete(submissionFile)
			.where(eq(submissionFile.id, fileId))
			.returning({ key: submissionFile.storageKey });
		if (!deleted) return NOT_FOUND;
		await tx
			.update(submission)
			.set({ updatedAt: new Date() })
			.where(eq(submission.id, access.row.id));
		return { ok: true, key: deleted.key } as const;
	});
	if (!done.ok) return done;
	await removeLeftovers([done.key]);
	return { ok: true } as const;
}

// A file and its bytes for its student or a teacher of the class. Undefined for everyone else.
export async function openFile(actor: UserId, fileId: SubmissionFileId) {
	const [found] = await db
		.select({
			file: submissionFile,
			stepId: submission.stepId,
			studentId: submission.studentId,
		})
		.from(submissionFile)
		.innerJoin(submission, eq(submission.id, submissionFile.submissionId))
		.where(eq(submissionFile.id, fileId));
	if (!found) return undefined;
	const access = await stepFor(db, actor, found.stepId);
	const allowed =
		access?.role === "teacher" || (access?.role === "student" && found.studentId === actor);
	if (!allowed) return undefined;
	// No bytes means a delete committed between the row read and this one, so the file is gone.
	const bytes = await storage.read(found.file.storageKey);
	return bytes && { file: found.file, bytes };
}

async function actorOf(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers });
	return session ? UserId.assert(session.user.id) : undefined;
}

// Not signed in, not allowed, and not there all look the same from outside.
const notFound = () => Response.json(NOT_FOUND, { status: 404 });

// Room for the multipart boundaries and headers around the file.
const FORM_OVERHEAD = 64 * 1024;

const STATUS_FOR: Partial<Record<string, number>> = {
	not_found: 404,
	forbidden: 404,
	file_too_large: 413,
};

// POST /api/files/upload/$stepId with a multipart form holding one `file`.
// The length is checked before the body is read, so an oversized upload is never held in memory.
export async function handleUpload(request: Request, rawStepId: string) {
	const actor = await actorOf(request);
	const stepId = StepId(rawStepId);
	if (!actor || stepId instanceof type.errors) return notFound();
	const length = Number(request.headers.get("content-length"));
	if (!Number.isInteger(length) || length <= 0) {
		return Response.json(fail("length_required"), { status: 411 });
	}
	if (length > FILE_LIMITS.maxBytes + FORM_OVERHEAD) {
		return Response.json(fail("file_too_large"), { status: 413 });
	}
	const form = await request.formData().catch(() => undefined);
	const file = form?.get("file");
	if (!(file instanceof File)) return Response.json(fail("no_file"), { status: 400 });
	const result = await uploadFile(actor, stepId, file);
	if (result.ok) return Response.json(result, { status: 201 });
	return Response.json(result, { status: STATUS_FOR[result.reason] ?? 400 });
}

// RFC 6266: a plain ASCII name for old clients, and the real name percent-encoded for the rest.
export function contentDisposition(filename: string) {
	const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
	const encoded = encodeURIComponent(filename).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// GET /api/files/$fileId. Always a download, never shown inline, so an uploaded file can't run as a
// page on our origin.
export async function handleDownload(request: Request, rawFileId: string) {
	const actor = await actorOf(request);
	const fileId = SubmissionFileId(rawFileId);
	if (!actor || fileId instanceof type.errors) return notFound();
	const found = await openFile(actor, fileId);
	if (!found) return notFound();
	return new Response(found.bytes, {
		headers: {
			"Content-Type": found.file.mimeType,
			"Content-Length": String(found.bytes.length),
			"Content-Disposition": contentDisposition(found.file.filename),
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
		},
	});
}
