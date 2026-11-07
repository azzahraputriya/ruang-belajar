// Owns: preparing the test database once per test run (applying migrations), and removing the test uploads folder after it. Not here: per-test cleanup (src/test/setup.ts).

import { rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { TestProject } from "vitest/node";

export async function setup(project: TestProject) {
	const url = project.config.env.DATABASE_URL;
	if (!url) throw new Error("vitest.config.ts must set DATABASE_URL");
	const db = drizzle(url);
	try {
		await migrate(db, { migrationsFolder: "drizzle" });
	} finally {
		await db.$client.end();
	}
	const uploads = project.config.env.UPLOAD_DIR;
	if (!uploads) throw new Error("vitest.config.ts must set UPLOAD_DIR");
	return () => rm(uploads, { recursive: true, force: true });
}
