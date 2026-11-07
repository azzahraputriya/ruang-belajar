// Owns: the HTTP endpoint that uploads one file to the signed-in student's submission on a step. Not here: the limits and access rules (src/server/submission-files.ts).

import { createFileRoute } from "@tanstack/react-router";
import { handleUpload } from "#/server/submission-files";

export const Route = createFileRoute("/api/files/upload/$stepId")({
	server: {
		handlers: {
			POST: ({ request, params }) => handleUpload(request, params.stepId),
		},
	},
});
