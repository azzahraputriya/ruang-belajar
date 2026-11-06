// The container runs this before the server. `pnpm build` bundles it into .output/migrate,
// so the runtime image needs no node_modules. Reads only DATABASE_URL, not the full app env.
import { migrateDatabase } from "#/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
await migrateDatabase(url);
