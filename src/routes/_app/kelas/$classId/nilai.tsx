// Owns: the teacher's class-wide grading queue pane at /kelas/$classId/nilai?kiriman=…, and its not-found message. Not here: the queue itself (src/components/grading-queue.tsx).

import { createFileRoute, notFound } from "@tanstack/react-router";
import { type } from "arktype";
import { GradingQueue } from "#/components/grading-queue";
import { PaneMessage } from "#/components/pane-message";
import { ClassId } from "#/db/ids";
import { gradingQueueQuery } from "#/server/submission-fns";

export const Route = createFileRoute("/_app/kelas/$classId/nilai")({
	// Only picks which work is open. Anything that isn't a known id just opens the first, so the
	// value is never refused: the router would show an error screen for a failed check.
	validateSearch: type({ "kiriman?": "unknown" }),
	loader: async ({ params, parentMatchPromise, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		const { loaderData } = await parentMatchPromise;
		if (classId instanceof type.errors || loaderData?.cls.myRole !== "teacher") throw notFound();
		await queryClient.ensureQueryData(gradingQueueQuery(user.id, classId));
		return { classId };
	},
	component: QueuePane,
	notFoundComponent: () => <PaneMessage title="Halaman tidak ditemukan." />,
});

function QueuePane() {
	const { classId } = Route.useLoaderData();
	const { user } = Route.useRouteContext();
	const { kiriman } = Route.useSearch();
	return (
		<GradingQueue
			userId={user.id}
			classId={classId}
			selected={typeof kiriman === "string" ? kiriman : undefined}
		/>
	);
}
