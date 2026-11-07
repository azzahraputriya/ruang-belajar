// Owns: the upload limits and file extensions both the browser and the server check, so the picker and the server never disagree. Not here: the server's checks of each file's type and bytes (src/server/submission-files.ts).

export const FILE_LIMITS = { maxBytes: 10 * 1024 * 1024, perSubmission: 5 } as const;

export const UPLOAD_EXTENSIONS = [
	"pdf",
	"png",
	"jpg",
	"jpeg",
	"webp",
	"docx",
	"xlsx",
	"pptx",
	"txt",
] as const;
export type UploadExtension = (typeof UPLOAD_EXTENSIONS)[number];

// For the file picker's `accept`.
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");

export const isUploadExtension = (value: string): value is UploadExtension =>
	UPLOAD_EXTENSIONS.some((e) => e === value);
