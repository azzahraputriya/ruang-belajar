// Owns: opening a class, which resumes at the student's first unfinished step or the teacher's first step, and the empty pane when there are no steps. Not here: the class layout (src/routes/_app/kelas/$classId.tsx) or the resume rule (src/lib/reading-order.ts).

import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { type } from "arktype";
import { Plus } from "lucide-react";
import { PaneMessage } from "#/components/pane-message";
import { buttonVariants } from "#/components/ui/button";
import { ClassId } from "#/db/ids";
import { resumeStep } from "#/lib/reading-order";
import { modulesQuery, progressQuery } from "#/server/module-fns";

export const Route = createFileRoute("/_app/kelas/$classId/")({
	// Only reads, so a hover preload is harmless. `replace` keeps Back from bouncing here again.
	loader: async ({ params, parentMatchPromise, context: { queryClient, user } }) => {
		const classId = ClassId(params.classId);
		const { loaderData } = await parentMatchPromise;
		if (classId instanceof type.errors || !loaderData) throw notFound();
		const student = loaderData.cls.myRole === "student";
		const [modules, statusById] = await Promise.all([
			queryClient.ensureQueryData(modulesQuery(user.id, classId)),
			student ? queryClient.ensureQueryData(progressQuery(user.id, classId)) : new Map(),
		]);
		const step = resumeStep(modules, statusById);
		if (step) {
			throw redirect({
				to: "/kelas/$classId/langkah/$stepId",
				params: { classId, stepId: step.id },
				replace: true,
			});
		}
		return { teacher: !student, hasModules: modules.length > 0 };
	},
	component: NoSteps,
});

function NoSteps() {
	const { teacher, hasModules } = Route.useLoaderData();
	const { classId } = Route.useParams();
	// With modules but no steps, the syllabus's "+ Langkah" is the next move, so no button here.
	return (
		<PaneMessage title={hasModules ? "Belum ada langkah." : "Belum ada modul."}>
			{teacher && !hasModules ? (
				<Link to="/kelas/$classId/modul-baru" params={{ classId }} className={buttonVariants()}>
					<Plus /> Modul
				</Link>
			) : null}
		</PaneMessage>
	);
}
