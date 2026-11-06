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

export default definePlugin({
	meta: { name: "ruang" },
	rules: { "file-header": fileHeader },
});
