// Project rules oxlint has no built-in for. Loaded through `jsPlugins` in `.oxlintrc.json`.

import { definePlugin, defineRule } from "@oxlint/plugins";

const HEADER = /^\s*Owns: \S/;

// Every source file opens with `// Owns: ...` so an agent knows what belongs in it before adding code.
const fileHeader = defineRule({
	meta: {
		type: "suggestion",
		messages: {
			missing:
				'Start this file with a header saying what it owns, e.g. "// Owns: class invites (create, accept, decline, revoke). Not here: role changes." See every file\'s header with: rg "^// Owns:" src',
		},
	},
	create(context) {
		return {
			Program(node) {
				const [first] = context.sourceCode.getAllComments();
				if (first?.loc.start.line === 1 && HEADER.test(first.value)) return;
				context.report({ node, messageId: "missing" });
			},
		};
	},
});

// The module that defines the question_key table, however it is imported (`#/db/...` or `./...`).
const KEY_SCHEMA = /(^|\/)question-key-schema(\.ts)?$/;
// The only files that may import it: quiz grading and the teacher's quiz editor, and later the AI
// tutor. Anchored to src/server/, so tests, `*-fns.ts`, routes, components, and lib never match.
const KEY_READERS = /(^|\/)src\/server\/(quizzes|tutor)\.ts$/;

// Answer keys must never reach a student early. Every key read sits in one module that applies the
// reveal rule, so a server function, route, or component can't read keys and skip that rule. Client
// files would also pull the table into browser code. Server functions (`*-fns.ts`) stay out too:
// their handlers are server-only, but they are where a new screen's data gets shaped.
const questionKeyServerOnly = defineRule({
	meta: {
		type: "problem",
		messages: {
			forbidden:
				"Only src/server/quizzes.ts (and the AI tutor) may import the question_key schema, so every key read goes through the rule for when a student may see solutions. Call a function in src/server/quizzes.ts that returns only what this caller may see.",
		},
	},
	create(context) {
		if (KEY_READERS.test(context.filename.replaceAll("\\", "/"))) return {};
		/** @param {import("@oxlint/plugins").ESTree.Expression | null} source */
		const check = (source) => {
			if (
				source?.type === "Literal" &&
				typeof source.value === "string" &&
				KEY_SCHEMA.test(source.value)
			) {
				context.report({ node: source, messageId: "forbidden" });
			}
		};
		return {
			ImportDeclaration: (node) => check(node.source),
			ExportNamedDeclaration: (node) => check(node.source),
			ExportAllDeclaration: (node) => check(node.source),
			ImportExpression: (node) => check(node.source),
		};
	},
});

export default definePlugin({
	meta: { name: "ruang" },
	rules: { "file-header": fileHeader, "question-key-server-only": questionKeyServerOnly },
});
