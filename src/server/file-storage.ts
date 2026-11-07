// Owns: storing, reading, and removing uploaded bytes by storage key, behind one interface. Not here: who may upload or download (src/server/submission-files.ts).

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StorageKey } from "#/db/ids";
import { env } from "#/env";

// Local disk today. Object storage later only needs another implementation of this.
export type FileStorage = {
	put: (key: StorageKey, bytes: Uint8Array) => Promise<void>;
	// Undefined when nothing is stored under the key.
	read: (key: StorageKey) => Promise<Uint8Array<ArrayBuffer> | undefined>;
	// Removing a key that isn't there succeeds, so a retried delete is harmless.
	remove: (key: StorageKey) => Promise<void>;
};

const isMissing = (error: unknown) =>
	error instanceof Error && "code" in error && error.code === "ENOENT";

// One flat folder. A key is always a uuid we made, so it can't climb out of `root`.
export function diskStorage(root: string): FileStorage {
	const dir = resolve(root);
	const pathOf = (key: StorageKey) => join(dir, key);
	return {
		async put(key, bytes) {
			await mkdir(dir, { recursive: true });
			// Written aside and renamed into place, so a crash never leaves half a file under the key.
			const temp = `${pathOf(key)}.${randomUUID()}.part`;
			await writeFile(temp, bytes);
			await rename(temp, pathOf(key));
		},
		async read(key) {
			try {
				return new Uint8Array(await readFile(pathOf(key)));
			} catch (error) {
				if (isMissing(error)) return undefined;
				throw error;
			}
		},
		async remove(key) {
			await rm(pathOf(key), { force: true });
		},
	};
}

export const storage = diskStorage(env.UPLOAD_DIR);
