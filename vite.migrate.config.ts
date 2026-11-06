import { defineConfig } from "vite";

// Bundles scripts/migrate.ts with drizzle-orm and pg inlined into one file.
// Runs after the app build, which empties .output first.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	publicDir: false,
	ssr: { noExternal: true },
	build: {
		ssr: "scripts/migrate.ts",
		outDir: ".output/migrate",
		target: "node22",
		rollupOptions: { output: { entryFileNames: "migrate.mjs" } },
	},
});
