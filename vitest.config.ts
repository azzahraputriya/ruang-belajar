import { defineConfig } from "vitest/config";

const databaseUrl =
	process.env.TEST_DATABASE_URL ?? "postgres://ruang:ruang@127.0.0.1:5433/ruang_test";

// Tests empty every table before each test, so never point them at a real database.
if (!new URL(databaseUrl).pathname.endsWith("_test")) {
	throw new Error(`TEST_DATABASE_URL must name a database ending in _test, got ${databaseUrl}`);
}

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		// Only this checkout's tests. Agent worktrees under .claude/worktrees/ hold their own copies.
		include: ["src/**/*.test.ts"],
		env: {
			DATABASE_URL: databaseUrl,
			BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdef",
			BETTER_AUTH_URL: "http://localhost:3000",
		},
		globalSetup: ["src/test/global-setup.ts"],
		setupFiles: ["src/test/setup.ts"],
		// Test files share one database, so they run one at a time.
		fileParallelism: false,
	},
});
