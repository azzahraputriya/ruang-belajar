// Owns: preparing the test database once per test run (applying migrations). Not here: per-test cleanup (src/test/setup.ts).

import type { TestProject } from "vitest/node";
import { migrateDatabase } from "#/db/migrate";

export async function setup(project: TestProject) {
	const url = project.config.env.DATABASE_URL;
	if (!url) throw new Error("vitest.config.ts must set DATABASE_URL");
	await migrateDatabase(url);
}
