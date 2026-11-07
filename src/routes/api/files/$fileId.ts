// Owns: the HTTP endpoint that downloads one submission file. Not here: who may download it (src/server/submission-files.ts).

import { createFileRoute } from "@tanstack/react-router";
import { handleDownload } from "#/server/submission-files";

export const Route = createFileRoute("/api/files/$fileId")({
	server: {
		handlers: {
			GET: ({ request, params }) => handleDownload(request, params.fileId),
		},
	},
});
