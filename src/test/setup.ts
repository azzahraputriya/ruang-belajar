// Owns: giving every test an empty database and an empty uploads folder, and closing the connection and removing that folder after each file. Not here: migrations (src/test/global-setup.ts).

import { rm } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { db } from "#/db/client";
import { env } from "#/env";

// Empties every app table, so new tables need no change here. Migration history lives outside "public".
beforeEach(async () => {
	await db.execute(sql`
		DO $$ DECLARE tables text; BEGIN
			SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO tables
			FROM pg_tables WHERE schemaname = 'public';
			IF tables IS NOT NULL THEN EXECUTE 'TRUNCATE ' || tables || ' CASCADE'; END IF;
		END $$
	`);
	await rm(env.UPLOAD_DIR, { recursive: true, force: true });
});

afterAll(async () => {
	await db.$client.end();
	await rm(env.UPLOAD_DIR, { recursive: true, force: true });
});
