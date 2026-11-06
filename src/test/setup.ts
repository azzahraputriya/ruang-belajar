// Owns: giving every test an empty database and closing the connection after each file. Not here: migrations (src/test/global-setup.ts).

import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { db } from "#/db/client";

// Empties every app table, so new tables need no change here. Migration history lives outside "public".
beforeEach(async () => {
	await db.execute(sql`
		DO $$ DECLARE tables text; BEGIN
			SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO tables
			FROM pg_tables WHERE schemaname = 'public';
			IF tables IS NOT NULL THEN EXECUTE 'TRUNCATE ' || tables || ' CASCADE'; END IF;
		END $$
	`);
});

afterAll(async () => {
	await db.$client.end();
});
