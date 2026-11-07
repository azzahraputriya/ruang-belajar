// Owns: applying the SQL migrations in drizzle/ to a database. Not here: writing migrations (pnpm db:generate) or the production entry (scripts/migrate.ts).

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Safe to run on every start: Drizzle skips migrations the database already has.
// The folder is relative to the working directory, which is the repo root locally and /app in the container.
export async function migrateDatabase(url: string) {
	const db = drizzle(url);
	try {
		await migrate(db, { migrationsFolder: "drizzle" });
	} finally {
		await db.$client.end();
	}
}
