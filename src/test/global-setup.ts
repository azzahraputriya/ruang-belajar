// Owns: preparing the test database once per test run (applying migrations). Not here: per-test cleanup (src/test/setup.ts).

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
}
