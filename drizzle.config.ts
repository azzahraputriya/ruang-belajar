import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env itself. CI sets DATABASE_URL directly.
if (existsSync(".env")) process.loadEnvFile();

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");

export default defineConfig({
	dialect: "postgresql",
	// The key table is listed on its own: src/db/schema.ts leaves it out so the app's db client never carries it.
	schema: ["./src/db/schema.ts", "./src/db/question-key-schema.ts"],
	out: "./drizzle",
	dbCredentials: { url },
});
