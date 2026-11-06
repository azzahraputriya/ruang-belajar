// Owns: the one Drizzle database connection the server uses. Not here: table definitions (src/db/schema.ts).

import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import { env } from "#/env";

export const db = drizzle(env.DATABASE_URL, { schema });
